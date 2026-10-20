import { closeSync, createWriteStream, mkdirSync, openSync, readSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { net } from 'electron'
import { createPost, getPostByAwemeId, getSetting, type DbUser } from '../../database'
import { getDownloadPath } from '../media'
import { emitPostDownloaded } from '../scripts/emit'
import { isBackfillLimitMode } from '../download/limit-mode'
import { runWithConcurrency } from '../../utils/concurrency'
import { kuaishouAwemeId } from '../../../shared/platforms'
import { fetchProfileFeed } from './client'
import { mediaExtension } from './files'
import type { KuaishouWork } from './feed'
import { DOWNLOAD_TIMEOUT_MS, KuaishouQuotaError, withKuaishouDownloadThrottle } from './guard'

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

export async function downloadKuaishouCreator(
  user: DbUser,
  hooks: KuaishouDownloadHooks
): Promise<{ downloaded: number; skipped: number; aborted: boolean }> {
  const source = hooks.source ?? 'sync'
  let skipped = 0
  const pending: KuaishouWork[] = []

  hooks.onProgress?.({
    current: 0,
    total: 0,
    downloaded: 0,
    skipped: 0,
    message: `正在获取 ${user.nickname} 的投稿...`
  })
  const limit = hooks.limit > 0 ? hooks.limit : 0
  const backfill = isBackfillLimitMode()
  let examined = 0
  let cursor = ''
  let quotaError: KuaishouQuotaError | null = null
  const enough = (): boolean =>
    limit > 0 && (backfill ? pending.length >= limit : examined >= limit)
  while (!hooks.isAborted()) {
    let page: Awaited<ReturnType<typeof fetchProfileFeed>>
    try {
      page = await fetchProfileFeed(user.uid, cursor)
    } catch (error) {
      if (error instanceof KuaishouQuotaError) {
        quotaError = error
        break
      }
      throw error
    }
    if (page.works.length === 0) break
    for (const work of page.works) {
      if (enough()) break
      examined += 1
      if (getPostByAwemeId(kuaishouAwemeId(work.photoId))) {
        skipped += 1
        continue
      }
      pending.push(work)
    }
    if (enough() || page.finished) break
    cursor = page.cursor
  }

  if (quotaError && pending.length === 0) throw quotaError
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
    pending.map((work) => async () => downloadOneWork(user, work, source)),
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
  if (quotaError) throw quotaError
  return { downloaded, skipped, aborted: hooks.isAborted() }
}

export async function downloadKuaishouWork(
  user: DbUser,
  work: KuaishouWork,
  source: 'task' | 'sync' | 'single'
): Promise<boolean> {
  return downloadOneWork(user, work, source)
}

async function downloadOneWork(
  user: DbUser,
  work: KuaishouWork,
  source: 'task' | 'sync' | 'single'
): Promise<boolean> {
  const awemeId = kuaishouAwemeId(work.photoId)
  if (getPostByAwemeId(awemeId)) return false
  const folder = join(getDownloadPath(), user.sec_uid, work.photoId)
  try {
    mkdirSync(folder, { recursive: true })
    let produced = false
    if (work.photoType === 'images') {
      let index = 1
      for (const url of work.downloadUrls) {
        const file = await downloadAsset(url, join(folder, String(index)))
        if (file) {
          produced = true
          index += 1
        }
      }
    } else if (work.downloadUrls[0]) {
      const file = await downloadAsset(work.downloadUrls[0], join(folder, work.photoId))
      produced = Boolean(file)
    }
    if (!produced) throw new Error(`没有可用的作品地址：${work.photoId}`)
    if (work.coverUrl) {
      await downloadAsset(work.coverUrl, join(folder, `${work.photoId}_cover`)).catch((error) => {
        console.warn(`[Kuaishou] 封面下载失败 ${work.photoId}:`, error)
      })
    }
    if (work.musicUrl) {
      await downloadAsset(work.musicUrl, join(folder, `${work.photoId}_music`)).catch((error) => {
        console.warn(`[Kuaishou] 配乐下载失败 ${work.photoId}:`, error)
      })
    }
    const post = createPost({
      aweme_id: awemeId,
      user_id: user.id,
      sec_uid: user.sec_uid,
      nickname: user.nickname,
      caption: work.caption,
      desc: work.caption,
      aweme_type: work.photoType === 'images' ? 68 : 0,
      create_time: formatPublishTime(work.timestampMs),
      folder_name: work.photoId,
      cover_path: folder,
      video_path: folder
    })
    emitPostDownloaded(post, folder, source)
    return true
  } catch (error) {
    if (error instanceof KuaishouQuotaError) throw error
    console.error(`[Kuaishou] 下载失败 ${work.photoId}:`, error)
    rmSync(folder, { recursive: true, force: true })
    return false
  }
}

async function downloadAsset(url: string, fileWithoutExt: string): Promise<string> {
  const assetUrl = url.startsWith('//') ? `https:${url}` : url.replace(/^http:\/\//i, 'https://')
  if (!/^https:\/\//i.test(assetUrl)) throw new Error('作品地址不是 HTTPS')
  const response = await withKuaishouDownloadThrottle(() =>
    net.fetch(assetUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  )
  if (!response.ok || !response.body) throw new Error(`下载文件失败 HTTP ${response.status}`)
  const temporary = `${fileWithoutExt}.download`
  const body = response.body
  const stream =
    typeof (body as unknown as Readable).pipe === 'function'
      ? (body as unknown as Readable)
      : Readable.fromWeb(body as unknown as import('stream/web').ReadableStream<Uint8Array>)
  await pipeline(stream, createWriteStream(temporary))
  const header = new Uint8Array(16)
  const handle = openSync(temporary, 'r')
  try {
    readSync(handle, header, 0, header.length, 0)
  } finally {
    closeSync(handle)
  }
  const extension = mediaExtension(header)
  const finalName = `${fileWithoutExt}.${extension === 'bin' ? 'mp4' : extension}`
  renameSync(temporary, finalName)
  return finalName
}

function formatPublishTime(timestampMs: number): string {
  if (!timestampMs) return ''
  const date = new Date(timestampMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function readKuaishouConcurrency(): number {
  return Math.max(1, parseInt(getSetting('video_download_concurrency') || '2', 10) || 2)
}
