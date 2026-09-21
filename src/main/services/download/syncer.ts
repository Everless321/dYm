import { BrowserWindow } from 'electron'
import { join } from 'path'
import { DouyinDownloader } from 'polydl'
import {
  getUserById,
  getSetting,
  createPost,
  getPostByAwemeId,
  updateUserSyncStatus
} from '../../database'
import { convertFolderImagesToJpg } from './downloader'
import { validateDownloadFolder, cleanupFailedDownload, expectsMusic } from './validator'
import { emitPostDownloaded } from '../scripts/emit'
import { track } from '../telemetry'
import { getDownloadPath } from '../media'
import { diagnoseUserPost } from '../douyin/client'
import { fetchUserPostPages } from '../douyin/user-post'

/** 同步触发来源：手动 / 定时调度 */
export type SyncSource = 'manual' | 'schedule'

export interface SyncProgress {
  userId: number
  status: 'syncing' | 'completed' | 'failed' | 'stopped'
  nickname: string
  currentVideo: number
  totalVideos: number
  downloadedCount: number
  skippedCount: number
  message: string
}

interface SyncState {
  abort: boolean
}

/** 一次同步的最终结果。失败不抛出而是收敛在这里，调用方（调度器 / IPC）据此记录日志 */
export interface SyncResult {
  status: 'completed' | 'cancelled' | 'failed'
  downloaded: number
  skipped: number
  error?: string
}

const runningSyncs: Map<number, SyncState> = new Map()

function sendProgress(progress: SyncProgress): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('sync:progress', progress)
  }
}

export async function startUserSync(
  userId: number,
  options: { source?: SyncSource } = {}
): Promise<SyncResult> {
  const source: SyncSource = options.source ?? 'manual'
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

  const globalMaxDownloadCount = Math.max(0, parseInt(getSetting('max_download_count') || '0') || 0)
  const videoConcurrency = Math.max(
    1,
    parseInt(getSetting('video_download_concurrency') || '3') || 3
  )

  const downloadPath = getDownloadPath()
  const userPath = join(downloadPath, user.sec_uid)

  runningSyncs.set(userId, { abort: false })
  updateUserSyncStatus(userId, 'syncing')

  const maxDownloadCount =
    user.max_download_count > 0 ? user.max_download_count : globalMaxDownloadCount

  let downloadedCount = 0
  let skippedCount = 0
  let finishStatus: 'completed' | 'cancelled' | 'failed' = 'failed'
  let failureMessage: string | undefined

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
        descRaw?: string
        awemeType?: number
        createTime?: string
        musicStatus?: number
        musicPlayUrl?: string
      }
    }
    const videosToDownload: VideoToDownload[] = []

    console.log(`[Syncer] Starting to fetch videos for ${user.nickname}`)
    // 直连优先，被 Argus 拦（403「Uifid Not Found」）时自动补 uifid 或改走页面上下文
    for await (const postFilter of fetchUserPostPages(user.sec_uid, { maxCounts })) {
      if (syncState?.abort) break
      // 风控时抖音有两种返回，polydl 都不会抛错，不检查就会被当成「无新作品」并更新 last_sync_at：
      // - HTTP 403 + 非 JSON 响应体：解析不出 status_code，statusCode 为 null
      // - status_code≠0 且 aweme_list 为空的合法 JSON
      if (postFilter.statusCode === null) {
        const detail = await diagnoseUserPost(user.sec_uid)
        throw new Error(
          `抖音接口没有返回有效 JSON（${detail}），多半是被风控拦截，请重新登录后重试`
        )
      }
      if (postFilter.statusCode !== 0) {
        throw new Error(
          `抖音接口返回 status_code=${postFilter.statusCode}，通常是 Cookie 失效或触发风控，请重新登录后重试`
        )
      }

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
      finishStatus = 'cancelled'
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
      return { status: finishStatus, downloaded: downloadedCount, skipped: skippedCount }
    }

    console.log(
      `[Syncer] Fetch complete. Videos to download: ${videosToDownload.length}, skipped: ${skippedCount}`
    )

    if (videosToDownload.length === 0) {
      console.log(`[Syncer] No new videos to download for ${user.nickname}`)
      finishStatus = 'completed'
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
      return { status: finishStatus, downloaded: downloadedCount, skipped: skippedCount }
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
            const expectMusic = expectsMusic(awemeData)

            await downloader.createDownloadTasks(awemeData, userPath)

            const folderPath = join(userPath, awemeId)

            // Validate download
            if (!validateDownloadFolder(folderPath, awemeData.awemeType || 0, expectMusic)) {
              cleanupFailedDownload(folderPath)
              await downloader.createDownloadTasks(awemeData, userPath)

              if (!validateDownloadFolder(folderPath, awemeData.awemeType || 0, expectMusic)) {
                console.error(`[Syncer] Validation failed after retry for ${awemeId}`)
                cleanupFailedDownload(folderPath)
                return false
              }
            }

            // Image to JPG conversion
            if (
              (awemeData.awemeType || 0) === 68 &&
              getSetting('convert_images_to_jpg') === 'true'
            ) {
              await convertFolderImagesToJpg(join(userPath, awemeId))
            }

            const post = createPost({
              aweme_id: awemeId,
              user_id: user.id,
              sec_uid: user.sec_uid,
              nickname: awemeData.nickname || user.nickname,
              caption: awemeData.caption || '',
              // descRaw 为原始未转义文案；desc 会被 polydl 转义为下划线
              desc: awemeData.descRaw || awemeData.desc || '',
              aweme_type: awemeData.awemeType || 0,
              create_time: awemeData.createTime || '',
              folder_name: awemeId,
              video_path: folderPath,
              cover_path: folderPath,
              music_path: folderPath
            })
            emitPostDownloaded(post, folderPath, 'sync')

            return true
          } catch (error) {
            console.error(`[Syncer] Failed to download ${awemeId}:`, error)
            cleanupFailedDownload(join(userPath, awemeId))
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
      finishStatus = 'cancelled'
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
      finishStatus = 'completed'
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
    finishStatus = 'failed'
    failureMessage = (error as Error).message
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
    // 与下载任务共用事件，便于 Aptabase 对 videos 求和得到「总下载量」
    track('download_finished', {
      kind: 'sync',
      source,
      videos: downloadedCount,
      status: finishStatus
    })
  }
  return {
    status: finishStatus,
    downloaded: downloadedCount,
    skipped: skippedCount,
    error: failureMessage
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

export function getAllSyncingUserIds(): number[] {
  return Array.from(runningSyncs.keys())
}
