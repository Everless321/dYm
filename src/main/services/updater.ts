import { autoUpdater, UpdateInfo } from 'electron-updater'
import { app, BrowserWindow, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  info?: UpdateInfo
  progress?: number
  error?: string
}

let mainWindow: BrowserWindow | null = null

function sendStatus(status: UpdateStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', status)
  }
}

// 注册 IPC handlers（开发和生产环境都需要）
export function registerUpdaterHandlers(): void {
  ipcMain.handle('updater:check', async () => {
    if (is.dev) {
      throw new Error('开发环境不支持自动更新')
    }
    // 夜间版的 Release 里没有更新清单，检查只会报一个看不懂的错
    if (app.getVersion().includes('-nightly')) {
      throw new Error('夜间版不支持自动更新，请到 GitHub Releases 的 Nightly 页面手动下载')
    }
    try {
      const result = await autoUpdater.checkForUpdates()
      return result?.updateInfo
    } catch (error) {
      console.error('[Updater] Check failed:', error)
      throw error
    }
  })

  ipcMain.handle('updater:download', async () => {
    if (is.dev) {
      throw new Error('开发环境不支持自动更新')
    }
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      console.error('[Updater] Download failed:', error)
      throw error
    }
  })

  ipcMain.handle('updater:install', () => {
    if (is.dev) {
      throw new Error('开发环境不支持自动更新')
    }
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updater:getCurrentVersion', () => {
    return app.getVersion()
  })
}

// 初始化 autoUpdater（仅生产环境）
export function initUpdater(win: BrowserWindow): void {
  mainWindow = win

  // 不自动下载，让用户确认
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    sendStatus({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    sendStatus({ status: 'available', info })
  })

  autoUpdater.on('update-not-available', (info) => {
    sendStatus({ status: 'not-available', info })
  })

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({ status: 'downloading', progress: progress.percent })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendStatus({ status: 'downloaded', info })
  })

  autoUpdater.on('error', (err) => {
    sendStatus({ status: 'error', error: err.message })
  })
}
