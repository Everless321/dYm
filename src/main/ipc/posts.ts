import { ipcMain, shell } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, statSync, cpSync, rmSync } from 'fs'
import { mkdir, readdir, stat } from 'fs/promises'
import {
  getAllUsers,
  getAllPosts,
  getAllTags,
  deletePost,
  getPostById,
  getPostsByUserId,
  fixAllPostTitles,
  deletePostsByUserId,
  getMigrationCount,
  getMigrationSecUids,
  batchReplacePaths,
  getPostsByUserIdAll,
  deletePostByAwemeId,
  type PostFilters,
  type PostSortConfig
} from '../database'
import { findCoverFile, findMediaFiles, getDownloadPath } from '../services/media'
import { assertFolderName, assertSecUid } from '../utils/path-segment'
import { checkPostFileIntegrity, cleanupFailedDownload } from '../services/download-validator'

export function registerPostIpc(): void {
  // Post IPC handlers
  ipcMain.handle(
    'post:getAll',
    (_event, page?: number, pageSize?: number, filters?: PostFilters, sort?: PostSortConfig) =>
      getAllPosts(page, pageSize, filters, sort)
  )
  ipcMain.handle('post:getAllTags', () => getAllTags())
  ipcMain.handle('post:getCoverPath', (_event, secUid: string, folderName: string) =>
    findCoverFile(secUid, folderName)
  )
  ipcMain.handle(
    'post:getMediaFiles',
    (_event, secUid: string, folderName: string, awemeType: number) =>
      findMediaFiles(secUid, folderName, awemeType)
  )
  ipcMain.handle('post:openFolder', async (_event, secUid: string, folderName: string) => {
    assertSecUid(secUid)
    const folderPath = join(getDownloadPath(), secUid, assertFolderName(folderName))
    // 具体文件夹不存在时退回作者目录
    const userPath = join(getDownloadPath(), secUid)
    const target = existsSync(folderPath) ? folderPath : existsSync(userPath) ? userPath : null
    if (!target) {
      throw new Error(`目录不存在：${folderPath}`)
    }
    // openPath 失败时 resolve 一个错误字符串而不是 reject
    const failure = await shell.openPath(target)
    if (failure) throw new Error(failure)
  })

  // Files management IPC handlers
  ipcMain.handle(
    'files:getUserPosts',
    (_event, userId: number, page?: number, pageSize?: number, sort?: PostSortConfig) =>
      getPostsByUserId(userId, page, pageSize, sort)
  )

  // 批量修复历史视频标题（从 _desc.txt 回填原始文案）
  ipcMain.handle('files:fixAllTitles', async () => {
    try {
      const result = fixAllPostTitles()
      return { success: true, result }
    } catch (error) {
      console.error('[IPC] fixAllTitles failed:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('files:getFileSizes', async (_event, secUid: string) => {
    const basePath = join(getDownloadPath(), secUid)
    if (!existsSync(basePath)) return { totalSize: 0, folderCount: 0 }
    let totalSize = 0
    let folderCount = 0
    try {
      // 用异步 fs 遍历，避免同步 statSync 阻塞主进程事件循环导致全局卡顿
      const folders = await readdir(basePath, { withFileTypes: true })
      for (const folder of folders) {
        if (!folder.isDirectory()) continue
        folderCount++
        const folderPath = join(basePath, folder.name)
        try {
          const files = await readdir(folderPath)
          const sizes = await Promise.all(
            files.map((file) =>
              stat(join(folderPath, file))
                .then((s) => s.size)
                .catch(() => 0)
            )
          )
          totalSize += sizes.reduce((sum, size) => sum + size, 0)
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
    return { totalSize, folderCount }
  })

  ipcMain.handle('files:getPostSize', (_event, secUid: string, folderName: string) => {
    const folderPath = join(getDownloadPath(), assertSecUid(secUid), assertFolderName(folderName))
    if (!existsSync(folderPath)) return 0
    let total = 0
    try {
      const files = readdirSync(folderPath)
      for (const file of files) {
        try {
          total += statSync(join(folderPath, file)).size
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
    return total
  })

  ipcMain.handle('files:deletePost', (_event, postId: number) => {
    const post = getPostById(postId)
    if (!post) return false
    // 先删文件再删记录：文件被占用（Windows EBUSY）时保留记录，用户还能再试；反过来会留下无主文件
    if (post.folder_name) {
      const folderPath = join(getDownloadPath(), post.sec_uid, post.folder_name)
      if (existsSync(folderPath)) {
        rmSync(folderPath, { recursive: true, force: true })
      }
    }
    deletePost(postId)
    return true
  })

  ipcMain.handle('files:deleteUserFiles', (_event, userId: number, secUid: string) => {
    const userDir = join(getDownloadPath(), assertSecUid(secUid))
    if (existsSync(userDir)) {
      // 只删作品子目录；头像等用户级文件留下，用户记录本身还在
      for (const entry of readdirSync(userDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          rmSync(join(userDir, entry.name), { recursive: true, force: true })
        }
      }
    }
    return deletePostsByUserId(userId)
  })

  // Post integrity check & redownload IPC handlers
  ipcMain.handle('post:scanBroken', async () => {
    const downloadPath = getDownloadPath()
    const results: {
      postId: number
      awemeId: string
      nickname: string
      folderPath: string
      reason: string
    }[] = []

    const users = getAllUsers()
    for (const user of users) {
      const posts = getPostsByUserIdAll(user.id)
      for (const post of posts) {
        const folderPath = join(downloadPath, user.sec_uid, post.folder_name)
        const { valid, reason } = checkPostFileIntegrity(folderPath, post.aweme_type)
        if (!valid) {
          results.push({
            postId: post.id,
            awemeId: post.aweme_id,
            nickname: post.nickname,
            folderPath,
            reason
          })
        }
      }
    }
    return results
  })

  ipcMain.handle('post:redownload', async (_event, awemeId: string) => {
    const post = deletePostByAwemeId(awemeId)
    if (!post) throw new Error('作品记录不存在')

    if (post.video_path) {
      cleanupFailedDownload(post.video_path)
      if (existsSync(post.video_path)) {
        const files = readdirSync(post.video_path)
        const nonTmpFiles = files.filter((f) => !f.endsWith('.tmp'))
        if (nonTmpFiles.length === 0) {
          rmSync(post.video_path, { recursive: true, force: true })
        }
      }
    }

    return { success: true, message: '已删除记录，下次同步时将重新下载' }
  })

  ipcMain.handle('post:batchRedownload', async (_event, awemeIds: string[]) => {
    let success = 0
    let failed = 0

    for (const awemeId of awemeIds) {
      try {
        const post = deletePostByAwemeId(awemeId)
        if (!post) {
          failed++
          continue
        }

        if (post.video_path) {
          cleanupFailedDownload(post.video_path)
          if (existsSync(post.video_path)) {
            const files = readdirSync(post.video_path)
            const nonTmpFiles = files.filter((f) => !f.endsWith('.tmp'))
            if (nonTmpFiles.length === 0) {
              rmSync(post.video_path, { recursive: true, force: true })
            }
          }
        }
        success++
      } catch {
        failed++
      }
    }

    return { success, failed }
  })

  // Migration IPC handler
  ipcMain.handle(
    'migration:execute',
    async (
      _event,
      oldPath: string,
      newPath: string
    ): Promise<{ success: number; failed: number; total: number }> => {
      const secUids = getMigrationSecUids(oldPath)
      const result = { success: 0, failed: 0, total: secUids.length }

      if (secUids.length === 0) return result

      const { rename: fsRename } = await import('fs/promises')
      await mkdir(newPath, { recursive: true })
      const movedSecUids: string[] = []

      for (const secUid of secUids) {
        const sourceDir = join(oldPath, secUid)
        const targetDir = join(newPath, secUid)

        try {
          if (!existsSync(sourceDir)) {
            result.failed++
            continue
          }

          if (existsSync(targetDir)) {
            // Target exists: move individual post folders
            const entries = readdirSync(sourceDir, { withFileTypes: true })
            for (const entry of entries) {
              if (!entry.isDirectory()) continue
              const src = join(sourceDir, entry.name)
              const dst = join(targetDir, entry.name)
              if (existsSync(dst)) continue
              try {
                await fsRename(src, dst)
              } catch {
                cpSync(src, dst, { recursive: true })
                rmSync(src, { recursive: true, force: true })
              }
            }
            // Clean up empty source dir
            const remaining = readdirSync(sourceDir)
            if (remaining.length === 0) rmSync(sourceDir, { force: true })
          } else {
            // Move entire author directory
            try {
              await fsRename(sourceDir, targetDir)
            } catch {
              cpSync(sourceDir, targetDir, { recursive: true })
              rmSync(sourceDir, { recursive: true, force: true })
            }
          }

          result.success++
          movedSecUids.push(secUid)
        } catch (error) {
          console.error(`[Migration] Failed to migrate ${secUid}:`, error)
          result.failed++
        }
      }

      // 只改真正搬过去的作者；搬失败的仍指向旧目录，文件还在那里
      batchReplacePaths(oldPath, newPath, movedSecUids)

      return result
    }
  )

  // Migration count handler
  ipcMain.handle('migration:getCount', (_event, oldPath: string) => {
    return getMigrationCount(oldPath)
  })
}
