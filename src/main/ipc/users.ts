import { ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import {
  getAllUsers,
  deleteUser,
  setUserShowInHome,
  updateUserSettings,
  batchUpdateUserSettings,
  type UpdateUserSettingsInput
} from '../database'
import { fetchUserProfile, parseDouyinUrl, getSecUserId } from '../services/douyin'
import { addUserByUrl } from '../services/user-add'
import { refreshUserProfile, getBatchRefreshDelay, sleep } from '../services/user-refresh'
import { getDownloadPath } from '../services/media'
import { stopUserSync, isUserSyncing } from '../services/syncer'
import { stopLiveRecording } from '../services/live-recorder'

export function registerUserIpc(): void {
  // Douyin IPC handlers
  ipcMain.handle('douyin:getUserProfile', (_event, url: string) => fetchUserProfile(url))
  ipcMain.handle('douyin:getSecUserId', (_event, url: string) => getSecUserId(url))
  ipcMain.handle('douyin:parseUrl', (_event, url: string) => parseDouyinUrl(url))

  // User IPC handlers
  ipcMain.handle('user:getAll', () => getAllUsers())
  ipcMain.handle('user:add', (_event, url: string) => addUserByUrl(url))
  ipcMain.handle('user:delete', (_event, id: number, deleteFiles?: boolean) => {
    // 先停掉进行中的同步 / 录制，再删库；否则同步线程会继续往已不存在的用户下写作品
    if (isUserSyncing(id)) stopUserSync(id)
    stopLiveRecording(id)
    const result = deleteUser(id)
    if (deleteFiles && result) {
      const downloadPath = getDownloadPath()
      const userDir = join(downloadPath, result.sec_uid)
      if (existsSync(userDir)) {
        rmSync(userDir, { recursive: true, force: true })
        console.log(`[User:delete] Removed files: ${userDir}`)
      }
    }
    return result
  })
  ipcMain.handle('user:setShowInHome', (_event, id: number, show: boolean) =>
    setUserShowInHome(id, show)
  )
  ipcMain.handle('user:updateSettings', (_event, id: number, input: UpdateUserSettingsInput) =>
    updateUserSettings(id, input)
  )
  ipcMain.handle(
    'user:batchUpdateSettings',
    (_event, ids: number[], input: Omit<UpdateUserSettingsInput, 'remark'>) =>
      batchUpdateUserSettings(ids, input)
  )
  ipcMain.handle('user:refresh', async (_event, id: number) => {
    const outcome = await refreshUserProfile(id)
    if (outcome.status === 'failed') {
      throw new Error(outcome.error || '获取用户信息失败')
    }
    return outcome.user
  })
  ipcMain.handle(
    'user:batchRefresh',
    async (_event, users: { id: number; homepage_url: string; nickname: string }[]) => {
      const results: { success: number; failed: number; details: string[] } = {
        success: 0,
        failed: 0,
        details: []
      }

      for (let i = 0; i < users.length; i++) {
        const u = users[i]
        const outcome = await refreshUserProfile(u.id)
        if (outcome.status === 'success') {
          results.success++
          results.details.push(`✅ ${outcome.user?.nickname || u.nickname}`)
        } else if (outcome.status === 'degraded') {
          // 疑似封号/冻结：已保留原昵称与头像
          results.success++
          results.details.push(`⚠️ ${u.nickname}: 疑似封号/冻结，已保留原名称与头像`)
        } else {
          results.failed++
          results.details.push(`❌ ${u.nickname}: ${outcome.error || '获取失败'}`)
        }
        // 限速：串行 + 随机间隔，规避风控（最后一个不再等待）
        if (i < users.length - 1) {
          await sleep(getBatchRefreshDelay())
        }
      }

      return results
    }
  )
}
