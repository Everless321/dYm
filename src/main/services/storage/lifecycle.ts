import { forgetPostObjects } from '../../database'
import { dropCachedMedia } from './cache'
import { deleteObject } from './client'
import { loadStorageConfig } from './config'

/**
 * 删除作品时连云端副本一起删。尽力而为：删云端失败只记日志不拦删除，
 * 否则断网时用户连本地作品都删不掉；失败留下的对象可以在桶里手动清理。
 */
export async function deleteCloudCopy(awemeId: string): Promise<void> {
  const keys = forgetPostObjects(awemeId)
  await dropCachedMedia(awemeId).catch(() => undefined)
  if (keys.length === 0) return
  const config = loadStorageConfig()
  if (!config) {
    console.warn(`[Storage] 作品 ${awemeId} 有 ${keys.length} 个云端对象，但对象存储未配置，未删除`)
    return
  }
  for (const key of keys) {
    try {
      await deleteObject(config, key)
    } catch (error) {
      console.warn(`[Storage] 删除云端对象失败 ${key}:`, (error as Error).message)
    }
  }
}

/** 重新下载：只忘掉记录和缓存，云端对象留着（重新上传时同名覆盖或直接认领） */
export async function forgetCloudCopy(awemeId: string): Promise<void> {
  forgetPostObjects(awemeId)
  await dropCachedMedia(awemeId).catch(() => undefined)
}
