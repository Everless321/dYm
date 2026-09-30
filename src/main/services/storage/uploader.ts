import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import {
  claimNextUpload,
  enqueuePosts,
  markUploadFailed,
  recordPostSynced,
  requeueInterruptedUploads,
  type QueuedPost
} from '../../database'
import { appEvents } from '../app-events'
import { resolvePostFolder } from '../media'
import { createObjectStore, listObjects } from './client'
import { loadStorageConfig, type StorageConfig } from './config'
import { parseObjectKey, planPostObjects, postKeyPrefix } from './keys'
import { startAutoPrune } from './prune'
import { syncPostObjects, type LocalObject, type SyncedObject } from './sync-post'

let active = 0

/** 按配置的并发数从队列里领作品上传；开关关着就只排队不传 */
export function kickUploads(): void {
  const config = loadStorageConfig()
  if (!config?.enabled) return
  while (active < config.concurrency) {
    let job: QueuedPost | null
    try {
      job = claimNextUpload()
    } catch (error) {
      console.error('[Storage] 领取上传任务失败:', (error as Error).message)
      return
    }
    if (!job) return
    active++
    void uploadPost(config, job).finally(() => {
      active--
      kickUploads()
    })
  }
}

/** 本地目录里要上传的文件；只剩封面（已清理过）或目录不在时返回 null，改走桶里认领 */
function localObjectsOf(job: QueuedPost): LocalObject[] | null {
  const folder = resolvePostFolder(job.sec_uid, job.folder_name || job.aweme_id)
  if (!folder) return null
  const plan = planPostObjects(readdirSync(folder), job.sec_uid, job.aweme_id)
  if (!plan.some((o) => o.kind !== 'cover')) return null
  return plan.map(({ file, ...rest }) => {
    const path = join(folder, file)
    return { ...rest, path, size: statSync(path).size }
  })
}

/**
 * 本地已经没有原文件（早先迁移后清理过）：桶里有这条作品的对象就直接认领。
 * 不能拿只剩封面的本地目录去「上传」，那样会把视频 / 图片的记录覆盖掉。
 */
async function claimFromBucket(config: StorageConfig, job: QueuedPost): Promise<SyncedObject[]> {
  const found = await listObjects(config, postKeyPrefix(job.sec_uid, job.aweme_id))
  const claimed = found.flatMap(({ key, size }) => {
    const parsed = parseObjectKey(key)
    return parsed ? [{ key, ...parsed, size, content_type: null }] : []
  })
  if (!claimed.some((o) => o.kind !== 'cover')) {
    throw new Error('本地没有原文件，桶里也没有这条作品的视频或图片')
  }
  return claimed
}

async function uploadPost(config: StorageConfig, job: QueuedPost): Promise<void> {
  try {
    const local = localObjectsOf(job)
    if (local) {
      recordPostSynced(job.aweme_id, await syncPostObjects(local, createObjectStore(config)))
    } else {
      recordPostSynced(job.aweme_id, await claimFromBucket(config, job), 'cloud_only')
    }
  } catch (error) {
    const message = (error as Error).message || String(error)
    console.warn(`[Storage] 作品 ${job.aweme_id} 上传失败:`, message)
    try {
      markUploadFailed(job.aweme_id, message)
    } catch (dbError) {
      console.error('[Storage] 记录上传失败状态出错:', (dbError as Error).message)
    }
  }
}

export function initStorageUploader(): void {
  const interrupted = requeueInterruptedUploads()
  if (interrupted > 0) console.log(`[Storage] 恢复 ${interrupted} 个上次未完成的上传`)

  appEvents.on('script-hook', (event: { hook: string; post?: { awemeId: string } }) => {
    if (event.hook !== 'post.downloaded' || !event.post) return
    if (!loadStorageConfig()?.enabled) return
    try {
      enqueuePosts([event.post.awemeId])
      kickUploads()
    } catch (error) {
      // 入队失败不能影响下载本身
      console.warn('[Storage] 新作品入队失败:', (error as Error).message)
    }
  })

  // 延后几秒再开跑，让窗口先起来
  setTimeout(kickUploads, 5000)
  startAutoPrune()
}
