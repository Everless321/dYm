import { readdirSync, statSync } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import {
  getPostObjects,
  listPruneCandidates,
  markPostCloudOnly,
  type StoredPost
} from '../../database'
import { resolvePostFolder } from '../media'
import { headObject } from './client'
import { loadStorageConfig, type StorageConfig } from './config'
import { planPostObjects } from './keys'
import { selectPrunableFiles, type SizedPlan } from './prune-plan'

export type PruneOutcome = { ok: true; bytes: number } | { ok: false; reason: string }

const AUTO_PRUNE_INTERVAL_MS = 30 * 60 * 1000
const AUTO_PRUNE_BATCH = 200

function sizedPlan(folder: string, post: StoredPost): SizedPlan[] {
  return planPostObjects(readdirSync(folder), post.sec_uid, post.aweme_id).map((o) => ({
    ...o,
    size: statSync(join(folder, o.file)).size
  }))
}

async function headSizes(config: StorageConfig, keys: string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>()
  for (const key of keys) {
    const size = await headObject(config, key)
    if (size !== null) sizes.set(key, size)
  }
  return sizes
}

/**
 * 清理一条作品的本地文件，只留封面。remote 给了就用（迁移向导刚列过整个桶），
 * 否则逐个 HEAD。dryRun 只算能腾出多少空间，不删不改状态。
 */
export async function prunePost(
  config: StorageConfig,
  post: StoredPost,
  remote: ReadonlyMap<string, number> | null,
  dryRun = false
): Promise<PruneOutcome> {
  const folder = resolvePostFolder(post.sec_uid, post.folder_name || post.aweme_id)
  if (!folder) {
    if (!dryRun) markPostCloudOnly(post.aweme_id)
    return { ok: true, bytes: 0 }
  }
  const plan = sizedPlan(folder, post)
  const recorded = new Map(getPostObjects(post.aweme_id).map((r) => [r.key, r.size]))
  const mediaKeys = plan.filter((o) => o.kind !== 'cover').map((o) => o.key)
  const bucket = remote ?? (await headSizes(config, mediaKeys))

  const selection = selectPrunableFiles(plan, recorded, bucket)
  if (!selection.ok) return selection
  if (!dryRun) {
    for (const file of selection.files) await unlink(join(folder, file))
    markPostCloudOnly(post.aweme_id)
  }
  return { ok: true, bytes: selection.bytes }
}

let autoRunning = false

/** 按保留期清理：上云超过 graceDays 的作品本地只留封面。每次最多处理一批，剩下的下一轮再说 */
export async function runAutoPrune(): Promise<void> {
  const config = loadStorageConfig()
  if (!config?.enabled || config.localPolicy !== 'covers' || autoRunning) return
  autoRunning = true
  try {
    const cutoff = Math.floor(Date.now() / 1000) - config.graceDays * 86400
    const candidates = listPruneCandidates(cutoff, AUTO_PRUNE_BATCH)
    let freed = 0
    for (const post of candidates) {
      try {
        const outcome = await prunePost(config, post, null)
        if (outcome.ok) freed += outcome.bytes
        else console.warn(`[Storage] 作品 ${post.aweme_id} 暂不清理本地：${outcome.reason}`)
      } catch (error) {
        console.warn(`[Storage] 清理作品 ${post.aweme_id} 本地文件失败:`, (error as Error).message)
      }
    }
    if (candidates.length > 0) {
      console.log(
        `[Storage] 自动清理本地 ${candidates.length} 个作品，腾出 ${(freed / 1024 ** 3).toFixed(2)} GB`
      )
    }
  } finally {
    autoRunning = false
  }
}

export function startAutoPrune(): void {
  setTimeout(() => void runAutoPrune(), 60_000)
  setInterval(() => void runAutoPrune(), AUTO_PRUNE_INTERVAL_MS)
}
