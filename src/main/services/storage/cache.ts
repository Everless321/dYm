import { app } from 'electron'
import { createWriteStream, existsSync, readdirSync, statSync } from 'fs'
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { getPostObjects } from '../../database'
import { describeNetworkError } from '../../utils/network-error'
import { resolvePostFolder } from '../media'
import { remoteObjectUrl } from './client'
import { loadStorageConfig } from './config'
import { localFileNameFor, planPostObjects } from './keys'

/**
 * 从云端取回原文件的本地缓存：只给必须读本地文件的功能用（AI 抽帧 / 图集分析），
 * 播放不走这里（直接用 https 地址）。每个作品一个目录，文件名沿用 polydl 命名，
 * 可以原样当作品目录用。按最近使用时间淘汰，总量不超过设置里的上限。
 */

const COMPLETE_MARKER = '.complete'

function cacheRoot(): string {
  return join(app.getPath('userData'), 'storage-cache')
}

function hasMedia(folder: string, secUid: string, awemeId: string): boolean {
  try {
    return planPostObjects(readdirSync(folder), secUid, awemeId).some((o) => o.kind !== 'cover')
  } catch {
    return false
  }
}

/** 同步版：本地目录有媒体就用本地；否则已经缓存好的缓存目录；都没有返回本地目录（可能为 null） */
export function resolveMediaFolder(
  secUid: string,
  folderName: string,
  awemeId: string
): string | null {
  const local = resolvePostFolder(secUid, folderName)
  if (local && hasMedia(local, secUid, awemeId)) return local
  const cached = join(cacheRoot(), awemeId)
  if (existsSync(join(cached, COMPLETE_MARKER))) return cached
  return local
}

async function download(url: string, dest: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) })
  } catch (error) {
    throw new Error(`下载 ${dest} 失败：${describeNetworkError(error)}`)
  }
  if (!res.ok || !res.body) throw new Error(`下载 ${dest} 失败：HTTP ${res.status}`)
  const tmp = `${dest}.tmp`
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp))
  await rename(tmp, dest)
}

async function dirSize(dir: string): Promise<number> {
  let total = 0
  for (const name of await readdir(dir)) {
    total += (await stat(join(dir, name))).size
  }
  return total
}

async function evict(limitBytes: number, keep: string): Promise<void> {
  const root = cacheRoot()
  const entries: { dir: string; used: number; size: number }[] = []
  for (const name of await readdir(root)) {
    const dir = join(root, name)
    try {
      const marker = statSync(join(dir, COMPLETE_MARKER))
      entries.push({ dir, used: marker.mtimeMs, size: await dirSize(dir) })
    } catch {
      // 没下完的残留目录直接清掉
      await rm(dir, { recursive: true, force: true })
    }
  }
  let total = entries.reduce((sum, e) => sum + e.size, 0)
  for (const e of entries.sort((a, b) => a.used - b.used)) {
    if (total <= limitBytes) break
    if (e.dir.endsWith(keep)) continue
    await rm(e.dir, { recursive: true, force: true })
    total -= e.size
  }
}

/**
 * 保证作品的原文件在本地可读，返回目录。本地有就直接用；本地已清理则从桶里取回到缓存。
 */
export async function ensureLocalMedia(post: {
  aweme_id: string
  sec_uid: string
  folder_name: string | null
}): Promise<string | null> {
  const folderName = post.folder_name || post.aweme_id
  const local = resolvePostFolder(post.sec_uid, folderName)
  if (local && hasMedia(local, post.sec_uid, post.aweme_id)) return local

  const rows = getPostObjects(post.aweme_id)
  if (rows.length === 0) return local
  const config = loadStorageConfig()
  if (!config) throw new Error('作品原文件在云端，但对象存储未配置，无法取回')

  const dir = join(cacheRoot(), post.aweme_id)
  const marker = join(dir, COMPLETE_MARKER)
  if (existsSync(marker)) {
    const now = new Date()
    await utimes(marker, now, now)
    return dir
  }

  await mkdir(dir, { recursive: true })
  for (const row of rows) {
    const name = localFileNameFor(post.aweme_id, row.kind, row.idx, row.content_type)
    await download(remoteObjectUrl(config, row.key), join(dir, name))
  }
  await writeFile(marker, '')
  await evict(config.cacheBytes, post.aweme_id).catch((error) =>
    console.warn('[Storage] 清理取回缓存失败:', (error as Error).message)
  )
  return dir
}

/** 作品被删 / 重下时顺手清掉它的缓存 */
export async function dropCachedMedia(awemeId: string): Promise<void> {
  await rm(join(cacheRoot(), awemeId), { recursive: true, force: true })
}
