import { app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { getSetting, setSetting, getAllSettings } from '../database'
import {
  fetchDouyinCookie,
  refreshDouyinCookieSilent,
  isCookieRefreshing
} from '../services/cookie'
import { refreshDouyinHandler } from '../services/douyin'
import { buildAuthHeaders, normalizeApiUrl } from '../services/analyzer'

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

  // Grok API verification
  ipcMain.handle('grok:verify', async (_event, apiKey: string, apiUrl: string, model: string) => {
    const response = await fetch(`${normalizeApiUrl(apiUrl)}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: buildAuthHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5
      })
    })
    if (!response.ok) {
      // 网关返回 HTML 错误页时 response.json() 会抛 SyntaxError，把真实状态码盖掉
      const text = await response.text()
      let detail = ''
      try {
        detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? ''
      } catch {
        detail = text.slice(0, 200)
      }
      throw new Error(
        `HTTP ${response.status} ${response.statusText}${detail ? `：${detail}` : ''}`
      )
    }
    return true
  })

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
