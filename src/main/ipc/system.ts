import { app, BrowserWindow, ipcMain, shell } from 'electron'
import os from 'os'
import {
  getDatabase,
  getDashboardOverview,
  getDownloadTrend,
  getUserVideoDistribution,
  getTopTags,
  getContentLevelDistribution
} from '../database'
import { blockCustomProtocols } from '../utils/block-protocols'
import { getWebServerInfo } from '../services/web-browser'

export function registerSystemIpc(): void {
  // Database IPC handlers
  ipcMain.handle('db:execute', (_event, sql: string, params?: unknown[]) => {
    const db = getDatabase()
    const stmt = db.prepare(sql)
    return params ? stmt.run(...params) : stmt.run()
  })

  ipcMain.handle('db:query', (_event, sql: string, params?: unknown[]) => {
    const db = getDatabase()
    const stmt = db.prepare(sql)
    return params ? stmt.all(...params) : stmt.all()
  })

  ipcMain.handle('db:queryOne', (_event, sql: string, params?: unknown[]) => {
    const db = getDatabase()
    const stmt = db.prepare(sql)
    return params ? stmt.get(...params) : stmt.get()
  })

  // Open data directory
  ipcMain.handle('system:openDataDirectory', async () => {
    const failure = await shell.openPath(app.getPath('userData'))
    if (failure) throw new Error(failure)
  })

  // Open URL in app browser (reuse douyin login session)
  ipcMain.handle('system:openInAppBrowser', (_event, url: string, title?: string) => {
    const partition = 'persist:douyin-login'
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      title: title || '抖音',
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    blockCustomProtocols(win)
    win.loadURL(url)
  })

  // System resource IPC handlers
  let lastCpuInfo = os.cpus()

  ipcMain.handle('system:getResourceUsage', () => {
    // Calculate CPU usage
    const currentCpuInfo = os.cpus()

    let totalIdle = 0
    let totalTick = 0

    for (let i = 0; i < currentCpuInfo.length; i++) {
      const cpu = currentCpuInfo[i]
      const lastCpu = lastCpuInfo[i]

      const idleDiff = cpu.times.idle - lastCpu.times.idle
      const totalDiff =
        cpu.times.user -
        lastCpu.times.user +
        cpu.times.nice -
        lastCpu.times.nice +
        cpu.times.sys -
        lastCpu.times.sys +
        cpu.times.idle -
        lastCpu.times.idle +
        cpu.times.irq -
        lastCpu.times.irq

      totalIdle += idleDiff
      totalTick += totalDiff
    }

    lastCpuInfo = currentCpuInfo

    const cpuUsage = totalTick > 0 ? Math.round(((totalTick - totalIdle) / totalTick) * 100) : 0

    // Calculate memory usage
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memoryUsage = Math.round((usedMem / totalMem) * 100)

    return {
      cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
      memoryUsage,
      memoryUsed: Math.round((usedMem / 1024 / 1024 / 1024) * 10) / 10,
      memoryTotal: Math.round((totalMem / 1024 / 1024 / 1024) * 10) / 10
    }
  })
  ipcMain.handle('system:getWebServerInfo', () => getWebServerInfo())

  // Dashboard
  ipcMain.handle('dashboard:getOverview', () => getDashboardOverview())
  ipcMain.handle('dashboard:getDownloadTrend', (_event, days?: number) => getDownloadTrend(days))
  ipcMain.handle('dashboard:getUserDistribution', (_event, limit?: number) =>
    getUserVideoDistribution(limit)
  )
  ipcMain.handle('dashboard:getTopTags', (_event, limit?: number) => getTopTags(limit))
  ipcMain.handle('dashboard:getContentLevelDistribution', () => getContentLevelDistribution())
}
