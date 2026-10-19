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
  type BilibiliVideoDetail
} from './client'
import { audioOnlyExtension, pickAudioStream, pickVideoStream, streamUrl } from './streams'

const execFileAsync = promisify(execFile)

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
): Promise<{ downloaded: number; skipped: number; aborted: boolean }> {
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
    return { downloaded: 0, skipped, aborted: true }
  }

  const total = pending.length
  let downloaded = 0
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
    pending.map((item) => async () => {
      const ok = await downloadOneVideo(user, item.bvid, settings, source, item.page)
      return ok
    }),
    hooks.concurrency,
    {
      shouldStop: () => hooks.isAborted() || riskError !== null,
      onComplete: (_index, result) => {
        if (result instanceof BilibiliRiskControlError) riskError = result
        finished += 1
        if (result === true) downloaded += 1
        hooks.onProgress?.({
          current: finished,
          total,
          downloaded,
          skipped,
          message: `已完成 ${finished}/${total}`
        })
      }
    }
  )

  if (riskError) throw riskError
  return { downloaded, skipped, aborted: hooks.isAborted() }
}

async function downloadOneVideo(
  user: DbUser,
  bvid: string,
  settings: BilibiliCreatorSettings,
  source: 'task' | 'sync' | 'single',
  requestedPage?: number
): Promise<boolean> {
  if (getPostByAwemeId(bvid)) return false
  const folder = join(getDownloadPath(), user.sec_uid, bvid)
  try {
    const detail = await fetchVideoDetail({ bvid })
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
    return true
  } catch (error) {
    console.error(`[Bilibili] 下载失败 ${bvid}:`, error)
    rmSync(folder, { recursive: true, force: true })
    if (error instanceof BilibiliRiskControlError) throw error
    return false
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
    const video = settings.downloadVideo
      ? pickVideoStream(play.dash?.video, settings.videoQuality, settings.videoCodec)
      : null
    const audio = settings.downloadAudio ? pickAudioStream(play.dash, settings.audioQuality) : null
    if (video) {
      videoFile = join(folder, `${stem}.video.m4s`)
      await downloadAsset(streamUrl(video), videoFile, referer)
    }
    if (audio) {
      audioFile = join(folder, `${stem}.audio.m4s`)
      await downloadAsset(streamUrl(audio), audioFile, referer)
    }
    if (!videoFile && !audioFile && play.durl?.[0]?.url) {
      await downloadAsset(play.durl[0].url, join(folder, `${stem}.mp4`), referer)
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
      headers: bilibiliHeaders(referer)
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
    const response = await net.fetch(track.url, { headers: bilibiliHeaders(referer) })
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

async function downloadAsset(url: string, file: string, referer: string): Promise<void> {
  const assetUrl = normalizeAssetUrl(url)
  if (!/^https:\/\//i.test(assetUrl)) throw new Error('播放地址不是 HTTPS')
  const response = await net.fetch(assetUrl, { headers: bilibiliHeaders(referer) })
  if (!response.ok || !response.body) {
    throw new Error(`下载文件失败 HTTP ${response.status}`)
  }
  const body = response.body
  if (!body) throw new Error('下载文件失败：响应为空')
  const stream =
    typeof (body as unknown as Readable).pipe === 'function'
      ? (body as unknown as Readable)
      : Readable.fromWeb(body as unknown as import('stream/web').ReadableStream<Uint8Array>)
  await pipeline(stream, createWriteStream(file))
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
