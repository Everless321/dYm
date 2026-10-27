import { renameSync, rmSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { KuaishouDownloader, type KuaishouDownloadResult, type KuaishouWork } from 'polydl'
import { createPost, getPostByAwemeId, getSetting, type DbUser } from '../../database'
import { getDownloadPath } from '../media'
import { emitPostDownloaded } from '../scripts/emit'
import { isBackfillLimitMode } from '../download/limit-mode'
import { runWithConcurrency } from '../../utils/concurrency'
import { kuaishouAwemeId } from '../../../shared/platforms'
import { fetchKuaishouFeedPage, fetchKuaishouWork } from './client'
import {
  KuaishouCooldownError,
  kuaishouCooldownLeft,
  waitKuaishouCooldown,
  withKuaishouDownloadThrottle
} from './guard'

/** 每个文件单次尝试的总时长上限。polydl 按总时长算，不是空闲时长，所以给足 */
const FILE_TIMEOUT_MS = 5 * 60_000
/** 冷却结束后第一页又被限流的次数上限，超过就不再等 */
const MAX_QUOTA_WAITS = 3

export interface KuaishouDownloadHooks {
  limit: number
  concurrency: number
  isAborted: () => boolean
  source?: 'task' | 'sync' | 'single'
  onProgress?: (event: {
    current: number
    total: number
    downloaded: number
    skipped: number
    message: string
  }) => void
}

export interface KuaishouDownloadOutcome {
  downloaded: number
  skipped: number
  aborted: boolean
  /** 翻页没翻完（验证码，或连续限流）：已列出的作品照常下完，这里说明原因 */
  notice?: string
}

/**
 * CDN 不需要登录态，也不该收到快手 Cookie，所以不给下载器传 cookie。
 * 目录是 <下载目录>/<sec_uid>/<作品 ID>/，与抖音、哔哩哔哩一致。
 */
const downloader = new KuaishouDownloader({
  naming: '{work_id}',
  cover: true,
  desc: false,
  mediaType: 'all',
  maxConcurrency: 2,
  retries: 3,
  timeout: FILE_TIMEOUT_MS
})

export async function downloadKuaishouCreator(
  user: DbUser,
  hooks: KuaishouDownloadHooks
): Promise<KuaishouDownloadOutcome> {
  const source = hooks.source ?? 'sync'
  let skipped = 0
  const pending: KuaishouWork[] = []
  let notice: string | undefined

  hooks.onProgress?.({
    current: 0,
    total: 0,
    downloaded: 0,
    skipped: 0,
    message: `正在获取 ${user.nickname} 的投稿...`
  })
  const limit = hooks.limit > 0 ? hooks.limit : 0
  // 与抖音一致：默认只看最新的 limit 个；补齐模式才继续往旧的翻，凑够 limit 个未下载的
  const backfill = isBackfillLimitMode()
  let examined = 0
  let pcursor = ''
  let quotaWaits = 0
  const enough = (): boolean =>
    limit > 0 && (backfill ? pending.length >= limit : examined >= limit)
  while (!hooks.isAborted()) {
    let page: Awaited<ReturnType<typeof fetchKuaishouFeedPage>>
    try {
      page = await fetchKuaishouFeedPage(user.uid, pcursor)
    } catch (error) {
      if (!(error instanceof KuaishouCooldownError)) throw error
      // 限流：等冷却结束，从同一页接着翻
      if (error.kind === 'quota' && quotaWaits < MAX_QUOTA_WAITS) {
        quotaWaits += 1
        hooks.onProgress?.({
          current: 0,
          total: 0,
          downloaded: 0,
          skipped,
          message: `快手限流，已看过 ${examined} 个投稿，约 ${Math.ceil(kuaishouCooldownLeft() / 60_000)} 分钟后接着翻`
        })
        await waitKuaishouCooldown(hooks.isAborted)
        continue
      }
      // 验证码或连续限流只封接口，已经列出来的作品还能下；一个都没列出就直接失败
      if (pending.length === 0) throw error
      notice = error.message
      break
    }
    quotaWaits = 0
    for (const work of page.works) {
      if (enough()) break
      examined += 1
      if (getPostByAwemeId(kuaishouAwemeId(work.workId))) {
        skipped += 1
        continue
      }
      pending.push(work)
    }
    if (enough() || page.finished || page.works.length === 0) break
    pcursor = page.pcursor
  }

  if (hooks.isAborted()) return { downloaded: 0, skipped, aborted: true }

  let downloaded = 0
  let finished = 0
  const total = pending.length
  hooks.onProgress?.({
    current: 0,
    total,
    downloaded,
    skipped,
    message: total === 0 ? `${user.nickname} 没有新的投稿` : `准备下载 ${total} 个投稿`
  })
  await runWithConcurrency(
    pending.map((work) => () => downloadKuaishouWork(user, work, source)),
    hooks.concurrency,
    {
      shouldStop: hooks.isAborted,
      onComplete: (_index, result) => {
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
  return { downloaded, skipped, aborted: hooks.isAborted(), notice }
}

/** 下载一条作品并入库。失败时删掉目录，返回 false */
export async function downloadKuaishouWork(
  user: DbUser,
  work: KuaishouWork,
  source: 'task' | 'sync' | 'single'
): Promise<boolean> {
  const awemeId = kuaishouAwemeId(work.workId)
  if (getPostByAwemeId(awemeId)) return false
  const userFolder = join(getDownloadPath(), user.sec_uid)
  const folder = join(userFolder, work.workId)
  try {
    const playable = await withMp4Address(work)
    const results = await withKuaishouDownloadThrottle(() =>
      downloader.downloadWork(playable, userFolder)
    )
    const media = results.filter((item) => item.kind === 'video' || item.kind === 'image')
    const failed = media.find((item) => !item.success)
    if (media.length === 0 || failed) {
      throw new Error(failed?.error || `没有可用的作品地址：${work.workId}`)
    }
    for (const item of results) renameToConvention(work.workId, item)
    const post = createPost({
      aweme_id: awemeId,
      user_id: user.id,
      sec_uid: user.sec_uid,
      nickname: user.nickname,
      caption: work.caption,
      desc: work.desc,
      aweme_type: work.workType === 'image' ? 68 : 0,
      create_time: work.createTime,
      folder_name: work.workId,
      cover_path: folder,
      video_path: folder
    })
    emitPostDownloaded(post, folder, source)
    return true
  } catch (error) {
    console.error(`[Kuaishou] 下载失败 ${work.workId}:`, error)
    rmSync(folder, { recursive: true, force: true })
    return false
  }
}

const isHls = (url: string): boolean => /\.m3u8(?:[?#]|$)/i.test(url)

/**
 * 投稿列表里有些视频只给 HLS（m3u8）地址，直接下只会存下一个播放列表文本。
 * 这时再请求一次作品详情，详情里有无水印的 mp4（photoUrl）。
 */
async function withMp4Address(work: KuaishouWork): Promise<KuaishouWork> {
  if (work.workType !== 'video' || (work.videoUrl && !isHls(work.videoUrl))) return work
  const detail = await fetchKuaishouWork(work.workId)
  if (!detail.videoUrl || isHls(detail.videoUrl)) {
    throw new Error(`作品只有 HLS 播放地址，没有可下载的 mp4：${work.workId}`)
  }
  return { ...work, videoUrl: detail.videoUrl, coverUrl: work.coverUrl || detail.coverUrl }
}

/**
 * polydl 写的是 video.mp4 / cover.jpg / image_0.jpg。
 * 播放、封面和对象存储都按抖音的 <id>_video / <id>_cover / <id>_image_<n> 认文件，这里改名对齐。
 */
function renameToConvention(workId: string, item: KuaishouDownloadResult): void {
  if (!item.success || !item.filePath) return
  const ext = extname(item.filePath)
  const name =
    item.kind === 'video'
      ? `${workId}_video${ext}`
      : item.kind === 'cover'
        ? `${workId}_cover${ext}`
        : item.kind === 'image'
          ? `${workId}_image_${(item.index ?? 0) + 1}${ext}`
          : ''
  if (!name || basename(item.filePath) === name) return
  renameSync(item.filePath, join(dirname(item.filePath), name))
}

export function readKuaishouConcurrency(): number {
  return Math.max(1, parseInt(getSetting('video_download_concurrency') || '2', 10) || 2)
}
