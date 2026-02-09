import { join } from 'path'
import { DouyinHandler, DouyinDownloader } from 'dy-downloader'
import {
  getUserById,
  getSetting,
  createPost,
  getPostByAwemeId,
  updateUserSyncStatus
} from '../database/index.js'
import { broadcast } from '../ws/index.js'
import type { SyncProgress } from '@dym/shared'

interface SyncState {
  abort: boolean
}

const runningSyncs: Map<number, SyncState> = new Map()

function sendProgress(progress: SyncProgress): void {
  broadcast({ channel: 'sync:progress', data: progress })
}

function getDownloadPath(): string {
  const customPath = getSetting('download_path')
  if (customPath && customPath.trim()) {
    return customPath
  }
  return join(process.env.DYM_DATA_DIR || join(process.cwd(), 'data'), 'Download', 'post')
}

export async function startUserSync(userId: number): Promise<void> {
  console.log(`[Syncer] Starting sync for user ID: ${userId}`)

  const user = getUserById(userId)
  if (!user) {
    console.log(`[Syncer] User not found: ${userId}`)
    throw new Error('用户不存在')
  }
  console.log(`[Syncer] Found user: ${user.nickname}`)

  if (runningSyncs.has(userId)) {
    console.log(`[Syncer] User ${user.nickname} is already syncing`)
    throw new Error('该用户正在同步中')
  }

  const cookie = getSetting('douyin_cookie')
  if (!cookie) {
    console.log(`[Syncer] Cookie not configured`)
    throw new Error('请先配置抖音 Cookie')
  }
  console.log(`[Syncer] Cookie found, length: ${cookie.length}`)

  const globalMaxDownloadCount = parseInt(getSetting('max_download_count') || '0') || 0
  const videoConcurrency = parseInt(getSetting('video_download_concurrency') || '3') || 3

  runningSyncs.set(userId, { abort: false })
  updateUserSyncStatus(userId, 'syncing')

  const downloadPath = getDownloadPath()
  const userPath = join(downloadPath, user.sec_uid)

  const maxDownloadCount = user.max_download_count > 0 ? user.max_download_count : globalMaxDownloadCount

  let downloadedCount = 0
  let skippedCount = 0

  try {
    console.log(`[Syncer] Sending initial progress for ${user.nickname}`)
    sendProgress({
      userId,
      status: 'syncing',
      nickname: user.nickname,
      currentVideo: 0,
      totalVideos: 0,
      downloadedCount: 0,
      skippedCount: 0,
      message: `正在获取 ${user.nickname} 的作品列表...`
    })

    console.log(`[Syncer] Creating DouyinHandler`)
    const handler = new DouyinHandler({ cookie })
    const downloader = new DouyinDownloader({
      cookie,
      downloadPath: userPath,
      naming: '{aweme_id}',
      folderize: true,
      cover: true,
      music: true,
      desc: true
    })

    const maxCounts = maxDownloadCount > 0 ? maxDownloadCount : 0
    const syncState = runningSyncs.get(userId)
    console.log(`[Syncer] maxCounts: ${maxCounts}, sec_uid: ${user.sec_uid}`)

    interface VideoToDownload {
      awemeId: string
      awemeData: {
        awemeId?: string
        nickname?: string
        caption?: string
        desc?: string
        awemeType?: number
        createTime?: string
      }
    }
    const videosToDownload: VideoToDownload[] = []

    console.log(`[Syncer] Starting to fetch videos for ${user.nickname}`)
    for await (const postFilter of handler.fetchUserPostVideos(user.sec_uid, { maxCounts })) {
      if (syncState?.abort) break

      const awemeList = postFilter.toAwemeDataList()
      for (const awemeData of awemeList) {
        if (syncState?.abort) break

        const awemeId = awemeData.awemeId
        if (!awemeId) continue

        const existing = getPostByAwemeId(awemeId)
        if (existing) {
          skippedCount++
          if (skippedCount % 20 === 0) {
            sendProgress({
              userId,
              status: 'syncing',
              nickname: user.nickname,
              currentVideo: downloadedCount,
              totalVideos: maxDownloadCount || user.aweme_count,
              downloadedCount,
              skippedCount,
              message: `已跳过 ${skippedCount} 个已下载作品...`
            })
          }
          continue
        }

        videosToDownload.push({ awemeId, awemeData })

        if (maxDownloadCount > 0 && videosToDownload.length >= maxDownloadCount) {
          break
        }
      }

      if (maxDownloadCount > 0 && videosToDownload.length >= maxDownloadCount) {
        break
      }
    }

    if (syncState?.abort) {
      updateUserSyncStatus(userId, 'idle')
      sendProgress({
        userId,
        status: 'stopped',
        nickname: user.nickname,
        currentVideo: downloadedCount,
        totalVideos: 0,
        downloadedCount,
        skippedCount,
        message: '同步已取消'
      })
      return
    }

    console.log(`[Syncer] Fetch complete. Videos to download: ${videosToDownload.length}, skipped: ${skippedCount}`)

    if (videosToDownload.length === 0) {
      console.log(`[Syncer] No new videos to download for ${user.nickname}`)
      const now = Math.floor(Date.now() / 1000)
      updateUserSyncStatus(userId, 'idle', now)
      sendProgress({
        userId,
        status: 'completed',
        nickname: user.nickname,
        currentVideo: 0,
        totalVideos: 0,
        downloadedCount: 0,
        skippedCount,
        message: `${user.nickname} 无新作品，跳过 ${skippedCount} 个已下载`
      })
      return
    }

    const totalToDownload = videosToDownload.length
    const batchSize = videoConcurrency
    const batchDelayMs = 3000

    sendProgress({
      userId,
      status: 'syncing',
      nickname: user.nickname,
      currentVideo: 0,
      totalVideos: totalToDownload,
      downloadedCount: 0,
      skippedCount,
      message: `开始下载 ${totalToDownload} 个视频...`
    })

    for (let i = 0; i < videosToDownload.length; i += batchSize) {
      if (syncState?.abort) break

      const batch = videosToDownload.slice(i, i + batchSize)
      const batchNum = Math.floor(i / batchSize) + 1
      const totalBatches = Math.ceil(videosToDownload.length / batchSize)

      sendProgress({
        userId,
        status: 'syncing',
        nickname: user.nickname,
        currentVideo: downloadedCount,
        totalVideos: totalToDownload,
        downloadedCount,
        skippedCount,
        message: `正在下载第 ${batchNum}/${totalBatches} 批...`
      })

      const batchResults = await Promise.all(
        batch.map(async ({ awemeId, awemeData }) => {
          if (syncState?.abort) return false

          try {
            await downloader.createDownloadTasks(awemeData, userPath)

            createPost({
              aweme_id: awemeId,
              user_id: user.id,
              sec_uid: user.sec_uid,
              nickname: awemeData.nickname || user.nickname,
              caption: awemeData.caption || '',
              desc: awemeData.desc || '',
              aweme_type: awemeData.awemeType || 0,
              create_time: awemeData.createTime || '',
              folder_name: awemeId,
              video_path: join(userPath, awemeId),
              cover_path: join(userPath, awemeId),
              music_path: join(userPath, awemeId)
            })

            return true
          } catch (error) {
            console.error(`[Syncer] Failed to download ${awemeId}:`, error)
            return false
          }
        })
      )

      downloadedCount += batchResults.filter(Boolean).length

      sendProgress({
        userId,
        status: 'syncing',
        nickname: user.nickname,
        currentVideo: downloadedCount,
        totalVideos: totalToDownload,
        downloadedCount,
        skippedCount,
        message: `已完成 ${downloadedCount}/${totalToDownload}`
      })

      if (i + batchSize < videosToDownload.length && !syncState?.abort) {
        sendProgress({
          userId,
          status: 'syncing',
          nickname: user.nickname,
          currentVideo: downloadedCount,
          totalVideos: totalToDownload,
          downloadedCount,
          skippedCount,
          message: `休息 ${batchDelayMs / 1000} 秒...`
        })
        await new Promise((resolve) => setTimeout(resolve, batchDelayMs))
      }
    }

    if (syncState?.abort) {
      updateUserSyncStatus(userId, 'idle')
      sendProgress({
        userId,
        status: 'stopped',
        nickname: user.nickname,
        currentVideo: downloadedCount,
        totalVideos: totalToDownload,
        downloadedCount,
        skippedCount,
        message: '同步已取消'
      })
    } else {
      const now = Math.floor(Date.now() / 1000)
      updateUserSyncStatus(userId, 'idle', now)
      const skipMsg = skippedCount > 0 ? `，跳过 ${skippedCount} 个已下载` : ''
      sendProgress({
        userId,
        status: 'completed',
        nickname: user.nickname,
        currentVideo: downloadedCount,
        totalVideos: downloadedCount,
        downloadedCount,
        skippedCount,
        message: `${user.nickname} 同步完成，新下载 ${downloadedCount} 个${skipMsg}`
      })
    }
  } catch (error) {
    console.error(`[Syncer] Error syncing user ${user.nickname}:`, error)
    updateUserSyncStatus(userId, 'error')
    sendProgress({
      userId,
      status: 'failed',
      nickname: user.nickname,
      currentVideo: downloadedCount,
      totalVideos: 0,
      downloadedCount,
      skippedCount,
      message: `同步失败: ${(error as Error).message}`
    })
  } finally {
    runningSyncs.delete(userId)
  }
}

export function stopUserSync(userId: number): void {
  const syncState = runningSyncs.get(userId)
  if (syncState) {
    syncState.abort = true
  }
}

export function isUserSyncing(userId: number): boolean {
  return runningSyncs.has(userId)
}

export function getAnyUserSyncing(): number | null {
  const entries = Array.from(runningSyncs.entries())
  return entries.length > 0 ? entries[0][0] : null
}
