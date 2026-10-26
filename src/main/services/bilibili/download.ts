import { execFile } from 'child_process'
import { createWriteStream, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import { net } from 'electron'
import { createPost, getPostByAwemeId, getSetting, type DbUser } from '../../database'
import { getDownloadPath } from '../media'
import { emitPostDownloaded } from '../scripts/emit'
import { isBackfillLimitMode } from '../download/limit-mode'
import { ffmpegPath } from '../../utils/ffmpeg-path'
import { runWithConcurrency } from '../../utils/concurrency'
import {
  parseBilibiliCreatorSettings,
  type BilibiliCreatorSettings
} from '../../../shared/platforms'
import {
  BilibiliRiskControlError,
  bilibiliCookie,
  bilibiliHeaders,
  fetchPlayUrl,
  fetchPublicationPage,
  fetchSubtitleTracks,
  fetchVideoDetail,
  normalizeAssetUrl,
  withApiThrottle,
  type BilibiliPage,
  type BilibiliPlayUrl,
  type BilibiliVideoDetail
} from './client'
import { audioOnlyExtension, pickAudioStream, pickVideoStream, streamUrls } from './streams'

const execFileAsync = promisify(execFile)
/** 这么久收不到任何数据就放弃这个地址，换下一个。不限总时长，大文件本来就要下很久 */
const ASSET_IDLE_TIMEOUT_MS = 30_000
const SIDE_FILE_TIMEOUT_MS = 20_000

export const PREVIEW_ONLY_MESSAGE = '充电专属或付费作品，当前账号只能试看'

/** 只能拿到试看片段（充电专属、付费）。跳过，不当成下载失败 */
class BilibiliPreviewOnlyError extends Error {}

export interface BilibiliDownloadHooks {
  limit: number
  concurrency: number
  isAborted: () => boolean
  /** 只下这些 BV，用于「添加作品链接时下载这一条」 */
  onlyBvids?: string[]
  page?: number
  source?: 'task' | 'sync' | 'single'
  onProgress?: (event: BilibiliDownloadProgress) => void
}

export interface BilibiliDownloadProgress {
  current: number
  total: number
  downloaded: number
  skipped: number
  message: string
}

export async function downloadBilibiliCreator(
  user: DbUser,
  hooks: BilibiliDownloadHooks
): Promise<{ downloaded: number; skipped: number; locked: number; aborted: boolean }> {
  if (!bilibiliCookie()) throw new Error('请先配置哔哩哔哩 Cookie')
  const settings = parseBilibiliCreatorSettings(user.platform_settings)
  if (!hasRequestedOutput(settings)) {
    throw new Error('请至少为该哔哩哔哩创作者选择一种下载内容')
  }

  const source = hooks.source ?? 'sync'
  let skipped = 0
  const pending: { bvid: string; page?: number }[] = []

  if (hooks.onlyBvids && hooks.onlyBvids.length > 0) {
    for (const bvid of hooks.onlyBvids) {
      if (getPostByAwemeId(bvid)) {
        skipped += 1
        continue
      }
      pending.push({ bvid, page: hooks.page })
    }
  } else {
    hooks.onProgress?.({
      current: 0,
      total: 0,
      downloaded: 0,
      skipped: 0,
      message: `正在获取 ${user.nickname} 的投稿列表...`
    })
    const limit = hooks.limit > 0 ? hooks.limit : 0
    // 与抖音一致：默认只看最新的 limit 个投稿；补齐模式才继续往旧的翻，凑够 limit 个未下载的
    const backfill = isBackfillLimitMode()
    let examined = 0
    const enough = (): boolean =>
      limit > 0 && (backfill ? pending.length >= limit : examined >= limit)
    let page = 1
    let total = 0
    while (!hooks.isAborted()) {
      const batch = await fetchPublicationPage(Number(user.uid), page)
      total = batch.total
      if (batch.videos.length === 0) break
      for (const video of batch.videos) {
        if (enough()) break
        examined += 1
        if (getPostByAwemeId(video.bvid)) {
          skipped += 1
          continue
        }
        pending.push({ bvid: video.bvid })
      }
      if (enough()) break
      if (page * batch.pageSize >= total) break
      page += 1
    }
  }

  if (hooks.isAborted()) {
    return { downloaded: 0, skipped, locked: 0, aborted: true }
  }

  const total = pending.length
  let downloaded = 0
  let locked = 0
  let finished = 0
  // 风控后立即停：已在下载的作品自然结束，不再领取新作品
  let riskError: BilibiliRiskControlError | null = null
  hooks.onProgress?.({
    current: 0,
    total,
    downloaded,
    skipped,
    message: total === 0 ? `${user.nickname} 没有新的投稿` : `准备下载 ${total} 个投稿`
  })

  await runWithConcurrency(
    pending.map((item) => () => downloadOneVideo(user, item.bvid, settings, source, item.page)),
    hooks.concurrency,
    {
      shouldStop: () => hooks.isAborted() || riskError !== null,
      onComplete: (_index, result) => {
        if (result instanceof BilibiliRiskControlError) riskError = result
        finished += 1
        if (result === 'downloaded') downloaded += 1
        if (result === 'locked') locked += 1
        hooks.onProgress?.({
          current: finished,
          total,
          downloaded,
          skipped,
          message: `已完成 ${finished}/${total}${lockedNote(locked)}`
        })
      }
    }
  )

  if (riskError) throw riskError
  return { downloaded, skipped, locked, aborted: hooks.isAborted() }
}

export function lockedNote(locked: number): string {
  return locked > 0 ? `，${locked} 个充电专属或付费作品只能试看，已跳过` : ''
}

async function downloadOneVideo(
  user: DbUser,
  bvid: string,
  settings: BilibiliCreatorSettings,
  source: 'task' | 'sync' | 'single',
  requestedPage?: number
): Promise<'downloaded' | 'failed' | 'locked'> {
  if (getPostByAwemeId(bvid)) return 'failed'
  const folder = join(getDownloadPath(), user.sec_uid, bvid)
  try {
    const detail = await fetchVideoDetail({ bvid })
    // 不请求播放地址：充电专属拿到的只有试看片段
    if (detail.chargeLocked) throw new BilibiliPreviewOnlyError('充电专属')
    const pages = selectPages(detail, settings, requestedPage)
    mkdirSync(folder, { recursive: true })
    let producedVideo = false
    for (const page of pages) {
      const saved = await downloadPage(detail, page, settings, folder, pages.length === 1)
      producedVideo = producedVideo || saved
    }
    if (settings.downloadCover && detail.pic) {
      try {
        await downloadAsset(
          detail.pic,
          join(folder, `${safeName(bvid)}_cover.jpg`),
          `https://www.bilibili.com/video/${bvid}`
        )
      } catch (error) {
        console.warn(`[Bilibili] 封面下载失败 ${bvid}:`, error)
        if (!producedVideo && !settings.downloadDanmaku && !settings.downloadSubtitle) throw error
      }
    }
    if (
      !producedVideo &&
      !settings.downloadCover &&
      !settings.downloadDanmaku &&
      !settings.downloadSubtitle
    ) {
      throw new Error('没有得到可保存的文件')
    }
    const post = createPost({
      aweme_id: bvid,
      user_id: user.id,
      sec_uid: user.sec_uid,
      nickname: user.nickname,
      caption: detail.title,
      desc: detail.desc,
      aweme_type: 0,
      create_time: formatPublishTime(detail.pubdate),
      folder_name: bvid,
      cover_path: folder,
      video_path: folder
    })
    emitPostDownloaded(post, folder, source)
    return 'downloaded'
  } catch (error) {
    rmSync(folder, { recursive: true, force: true })
    if (error instanceof BilibiliPreviewOnlyError) {
      console.warn(`[Bilibili] 只能试看，跳过 ${bvid}：${error.message}`)
      return 'locked'
    }
    console.error(`[Bilibili] 下载失败 ${bvid}:`, error)
    if (error instanceof BilibiliRiskControlError) throw error
    return 'failed'
  }
}

function selectPages(
  detail: BilibiliVideoDetail,
  settings: BilibiliCreatorSettings,
  requestedPage?: number
): BilibiliPage[] {
  if (settings.downloadAllPages) return detail.pages
  const pageNo = requestedPage && requestedPage > 0 ? requestedPage : 1
  return [detail.pages.find((page) => page.page === pageNo) ?? detail.pages[0]]
}

async function downloadPage(
  detail: BilibiliVideoDetail,
  page: BilibiliPage,
  settings: BilibiliCreatorSettings,
  folder: string,
  singlePage: boolean
): Promise<boolean> {
  const referer = `https://www.bilibili.com/video/${detail.bvid}`
  const stem = singlePage ? safeName(detail.bvid) : `${safeName(detail.bvid)}_p${page.page}`
  let videoFile = ''
  let audioFile = ''

  if (settings.downloadVideo || settings.downloadAudio) {
    const play = await fetchPlayUrl(detail.bvid, page.cid, settings.videoQuality)
    if (isPreviewOnly(play)) throw new BilibiliPreviewOnlyError('播放地址只有试看片段')
    const video = settings.downloadVideo
      ? pickVideoStream(play.dash?.video, settings.videoQuality, settings.videoCodec)
      : null
    const audio = settings.downloadAudio ? pickAudioStream(play.dash, settings.audioQuality) : null
    if (video) {
      videoFile = join(folder, `${stem}.video.m4s`)
      await downloadAsset(streamUrls(video), videoFile, referer)
    }
    if (audio) {
      audioFile = join(folder, `${stem}.audio.m4s`)
      await downloadAsset(streamUrls(audio), audioFile, referer)
    }
    const durl = play.durl?.[0]
    if (!videoFile && !audioFile && durl?.url) {
      const urls = [durl.url, ...(durl.backup_url ?? [])]
      await downloadAsset(urls, join(folder, `${stem}.mp4`), referer)
      videoFile = 'durl'
    }
    if (videoFile && videoFile !== 'durl') {
      const output = join(folder, `${stem}.mp4`)
      await muxMedia(videoFile, audioFile, output)
      unlinkSync(videoFile)
      if (audioFile) unlinkSync(audioFile)
    } else if (audioFile) {
      const ext = audio ? audioOnlyExtension(play.dash, audio) : 'm4a'
      await muxMedia('', audioFile, join(folder, `${stem}.${ext}`))
      unlinkSync(audioFile)
    }
    if ((settings.downloadVideo || settings.downloadAudio) && !videoFile && !audioFile) {
      throw new Error(`没有可用的播放地址：${detail.bvid} P${page.page}`)
    }
  }

  if (settings.downloadDanmaku) {
    await downloadDanmaku(page.cid, join(folder, `${stem}_danmaku.xml`), referer)
  }
  if (settings.downloadSubtitle) {
    await downloadSubtitles(detail.bvid, page.cid, folder, stem, referer)
  }
  return Boolean(videoFile || audioFile)
}

async function downloadDanmaku(cid: number, file: string, referer: string): Promise<void> {
  const response = await withApiThrottle(() =>
    net.fetch(`https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`, {
      headers: bilibiliHeaders(referer),
      // 弹幕请求占着全局接口队列，卡住会拖住所有 B 站请求
      signal: AbortSignal.timeout(SIDE_FILE_TIMEOUT_MS)
    })
  )
  if (!response.ok) return
  const text = (await response.text()).trim()
  if (!text.startsWith('<?xml') && !text.startsWith('<i')) return
  writeFileSync(file, text)
}

async function downloadSubtitles(
  bvid: string,
  cid: number,
  folder: string,
  stem: string,
  referer: string
): Promise<void> {
  const tracks = await fetchSubtitleTracks(bvid, cid)
  for (const track of tracks) {
    const response = await net.fetch(track.url, {
      headers: bilibiliHeaders(referer),
      signal: AbortSignal.timeout(SIDE_FILE_TIMEOUT_MS)
    })
    if (!response.ok) continue
    const payload = (await response.json()) as {
      body?: Array<{ from?: number; to?: number; content?: string }>
    }
    const cues = (payload.body ?? []).filter((cue) => cue.content)
    if (cues.length === 0) continue
    const srt = cues
      .map((cue, index) => {
        const from = srtTime(Number(cue.from) || 0)
        const to = srtTime(Number(cue.to) || 0)
        return `${index + 1}\n${from} --> ${to}\n${cue.content}\n`
      })
      .join('\n')
    writeFileSync(join(folder, `${stem}.${safeName(track.lan) || 'zh'}.srt`), srt)
  }
}

/** 不是 DASH、只有 durl，而且各段加起来明显短于完整时长：这是试看片段 */
function isPreviewOnly(play: BilibiliPlayUrl): boolean {
  if (play.dash || !play.durl?.length || !play.timelength) return false
  const length = play.durl.reduce((sum, part) => sum + (Number(part.length) || 0), 0)
  return length > 0 && length < play.timelength * 0.9
}

/** 依次尝试各个地址，一个失败或卡住就换下一个 */
async function downloadAsset(
  urls: string | string[],
  file: string,
  referer: string
): Promise<void> {
  const candidates = (Array.isArray(urls) ? urls : [urls]).map(normalizeAssetUrl)
  let lastError: Error = new Error('没有可用的下载地址')
  for (const url of candidates) {
    try {
      await downloadFrom(url, file, referer)
      return
    } catch (error) {
      lastError = error as Error
      console.warn(`[Bilibili] 下载地址失败，换下一个 ${url.slice(0, 60)}:`, lastError.message)
    }
  }
  throw lastError
}

async function downloadFrom(url: string, file: string, referer: string): Promise<void> {
  if (!/^https:\/\//i.test(url)) throw new Error('播放地址不是 HTTPS')
  const controller = new AbortController()
  const idle = setTimeout(() => controller.abort(), ASSET_IDLE_TIMEOUT_MS)
  try {
    const response = await net.fetch(url, {
      headers: bilibiliHeaders(referer),
      signal: controller.signal
    })
    if (!response.ok || !response.body) {
      throw new Error(`下载文件失败 HTTP ${response.status}`)
    }
    const body = response.body
    const stream =
      typeof (body as unknown as Readable).pipe === 'function'
        ? (body as unknown as Readable)
        : Readable.fromWeb(body as unknown as import('stream/web').ReadableStream<Uint8Array>)
    await pipeline(
      stream,
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          idle.refresh()
          yield chunk
        }
      },
      createWriteStream(file),
      // 超时由 pipeline 自己销毁数据流，不依赖 fetch 把中断传到响应体
      { signal: controller.signal }
    )
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${ASSET_IDLE_TIMEOUT_MS / 1000} 秒没有收到数据`)
    }
    throw error
  } finally {
    clearTimeout(idle)
  }
}

async function muxMedia(video: string, audio: string, output: string): Promise<void> {
  const args = ['-y']
  if (video) args.push('-i', video)
  if (audio) args.push('-i', audio)
  args.push('-c', 'copy')
  if (video && audio) args.push('-map', '0:v:0', '-map', '1:a:0', '-movflags', '+faststart')
  args.push(output)
  try {
    await execFileAsync(ffmpegPath, args)
  } catch (error) {
    throw new Error(`合并音视频失败：${(error as Error).message}`)
  }
}

function hasRequestedOutput(settings: BilibiliCreatorSettings): boolean {
  return (
    settings.downloadVideo ||
    settings.downloadAudio ||
    settings.downloadCover ||
    settings.downloadDanmaku ||
    settings.downloadSubtitle
  )
}

function formatPublishTime(unixSeconds: number): string {
  if (!unixSeconds) return ''
  const date = new Date(unixSeconds * 1000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function srtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds * 1000))
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const secs = Math.floor((total % 60_000) / 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(total % 1000, 3)}`
}

function safeName(value: string): string {
  return value.replace(/[^\w.-]+/g, '_')
}

export function readBilibiliConcurrency(): number {
  return Math.max(1, parseInt(getSetting('video_download_concurrency') || '2', 10) || 2)
}
