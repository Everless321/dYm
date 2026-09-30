import { getAllPostObjectSizes, listSyncedPostsOldestFirst, resetPostSync } from '../../database'
import type { MigrationStatus, PrunePreview } from '../../../shared/storage'
import { listObjects } from './client'
import { loadStorageConfig, type StorageConfig } from './config'
import { prunePost } from './prune'
import { diffCloudObjects } from './prune-plan'
import { kickUploads } from './uploader'

/**
 * 迁移向导的后台作业：核对（列整个桶和记录比对）与批量清理本地（按下载时间从早到晚取一部分）。
 * 同一时间只跑一个，状态在内存里，渲染层轮询。
 */

// 批量清理直接用核对时列出的桶清单，省掉几十万次 HEAD；清单太旧就要求重新核对
const REMOTE_SNAPSHOT_TTL_MS = 30 * 60 * 1000
const KEY_PREFIX = 'creators/'

let status: MigrationStatus = {
  task: null,
  phase: '',
  done: 0,
  total: 0,
  result: null,
  error: null
}
let remoteSnapshot: { sizes: Map<string, number>; at: number } | null = null

export function getMigrationStatus(): MigrationStatus {
  return { ...status, snapshotAgeMs: remoteSnapshot ? Date.now() - remoteSnapshot.at : null }
}

function requireConfig(): StorageConfig {
  const config = loadStorageConfig()
  if (!config) throw new Error('请先配置并保存对象存储')
  return config
}

function begin(task: NonNullable<MigrationStatus['task']>, phase: string, total = 0): void {
  if (status.task) throw new Error('已有迁移作业在进行，请等它结束')
  status = { task, phase, done: 0, total, result: null, error: null }
}

function finish(result: string | null, error: string | null): void {
  status = { ...status, task: null, phase: '', result, error }
}

export function startVerify(): void {
  const config = requireConfig()
  begin('verify', '列出桶里的对象')
  void (async () => {
    try {
      const listed = await listObjects(config, KEY_PREFIX, (n) => {
        status = { ...status, done: n }
      })
      const sizes = new Map(listed.map((o) => [o.key, o.size]))
      remoteSnapshot = { sizes, at: Date.now() }

      status = { ...status, phase: '比对上传记录' }
      const rows = getAllPostObjectSizes()
      const { checkedObjects, broken } = diffCloudObjects(rows, sizes)
      if (broken.size > 0) {
        resetPostSync([...broken.keys()])
        kickUploads()
        for (const [id, reason] of [...broken].slice(0, 20)) {
          console.warn(`[Storage] 核对不通过 ${id}: ${reason}`)
        }
      }
      finish(
        broken.size === 0
          ? `核对通过：${checkedObjects} 个对象全部在桶里且大小一致`
          : `核对完成：${checkedObjects} 个对象中 ${broken.size} 个作品对不上，已重新排队上传`,
        null
      )
    } catch (error) {
      finish(null, (error as Error).message)
    }
  })()
}

function pickOldest(fraction: number): ReturnType<typeof listSyncedPostsOldestFirst> {
  const posts = listSyncedPostsOldestFirst()
  const f = Math.min(Math.max(fraction, 0), 1)
  return posts.slice(0, Math.ceil(posts.length * f))
}

function freshSnapshot(): Map<string, number> {
  if (!remoteSnapshot || Date.now() - remoteSnapshot.at > REMOTE_SNAPSHOT_TTL_MS) {
    throw new Error('桶清单已过期，请先点「核对云端」再清理')
  }
  return remoteSnapshot.sizes
}

/** 预览：不删文件，统计按比例取出的作品里有多少能清理、腾出多少空间 */
export async function previewPrune(fraction: number): Promise<PrunePreview> {
  const config = requireConfig()
  const remote = freshSnapshot()
  const posts = pickOldest(fraction)
  let eligible = 0
  let bytes = 0
  let blocked = 0
  for (const post of posts) {
    const outcome = await prunePost(config, post, remote, true)
    if (outcome.ok) {
      eligible++
      bytes += outcome.bytes
    } else blocked++
  }
  return {
    candidates: posts.length,
    eligible,
    blocked,
    bytes,
    lastDownloadedAt: posts.at(-1)?.downloaded_at ?? null
  }
}

export function startPrune(fraction: number): void {
  const config = requireConfig()
  const remote = freshSnapshot()
  const posts = pickOldest(fraction)
  begin('prune', '清理本地文件', posts.length)
  void (async () => {
    let freed = 0
    let blocked = 0
    try {
      for (const post of posts) {
        try {
          const outcome = await prunePost(config, post, remote)
          if (outcome.ok) freed += outcome.bytes
          else blocked++
        } catch (error) {
          blocked++
          console.warn(`[Storage] 清理 ${post.aweme_id} 失败:`, (error as Error).message)
        }
        status = { ...status, done: status.done + 1 }
      }
      finish(
        `清理完成：${posts.length - blocked} 个作品本地只留封面，腾出 ${(freed / 1024 ** 3).toFixed(1)} GB` +
          (blocked > 0 ? `；${blocked} 个没通过核对，未删除` : ''),
        null
      )
    } catch (error) {
      finish(null, (error as Error).message)
    }
  })()
}
