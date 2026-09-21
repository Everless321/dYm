import { app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { getSetting, setSetting, getAllSettings } from '../database'
import {
  fetchDouyinCookie,
  refreshDouyinCookieSilent,
  isCookieRefreshing,
  resetLoginBrowser
} from '../services/douyin/cookie'
import { refreshDouyinHandler } from '../services/douyin/client'

export function registerSettingsIpc(): void {
  // Settings IPC handlers
  ipcMain.handle('settings:get', (_event, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
    // 更新 cookie 时刷新抖音客户端
    if (key === 'douyin_cookie') {
      refreshDouyinHandler()
    }
  })
  ipcMain.handle('settings:getAll', () => getAllSettings())

  // Cookie IPC handlers
  ipcMain.handle('cookie:fetchDouyin', async () => {
    const cookie = await fetchDouyinCookie()
    // 获取到 cookie 后刷新抖音客户端
    if (cookie) {
      refreshDouyinHandler()
    }
    return cookie
  })
  ipcMain.handle('cookie:refreshSilent', async () => {
    const cookie = await refreshDouyinCookieSilent()
    return cookie
  })
  ipcMain.handle('cookie:isRefreshing', () => isCookieRefreshing())
  ipcMain.handle('cookie:resetBrowser', () => resetLoginBrowser())

  // Download path IPC handler
  ipcMain.handle('settings:getDefaultDownloadPath', () => {
    return join(app.getPath('userData'), 'Download', 'post')
  })

  // Dialog IPC handlers
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择下载目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })
}
