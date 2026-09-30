import { ipcMain } from 'electron'
import { enqueueUnsyncedPosts, getStorageQueueStats, retryFailedUploads } from '../database'
import { testStorageConnection } from '../services/storage/client'
import {
  getStorageConfigView,
  loadStorageConfig,
  saveStorageConfig
} from '../services/storage/config'
import { kickUploads } from '../services/storage/uploader'
import {
  getMigrationStatus,
  previewPrune,
  startPrune,
  startVerify
} from '../services/storage/migration'
import type { StorageConfigInput, StorageTestResult } from '../../shared/storage'

export function registerStorageIpc(): void {
  ipcMain.handle('storage:getConfig', () => getStorageConfigView())

  ipcMain.handle('storage:saveConfig', (_event, input: StorageConfigInput) => {
    const view = saveStorageConfig(input)
    kickUploads()
    return view
  })

  ipcMain.handle('storage:test', async (): Promise<StorageTestResult> => {
    const config = loadStorageConfig()
    if (!config) return { ok: false, message: '请先填完 Endpoint、Bucket 和密钥并保存' }
    return testStorageConnection(config)
  })

  ipcMain.handle('storage:getStats', () => getStorageQueueStats())

  // 把现有作品全部排进队列：桶里已有同大小对象的直接认领，不会重传
  ipcMain.handle('storage:enqueueAll', () => {
    const count = enqueueUnsyncedPosts()
    kickUploads()
    return count
  })

  ipcMain.handle('storage:retryFailed', () => {
    const count = retryFailedUploads()
    kickUploads()
    return count
  })

  // 迁移向导：核对云端 → 预览 → 按比例清理本地（最早下载的先清）
  ipcMain.handle('storage:getMigrationStatus', () => getMigrationStatus())
  ipcMain.handle('storage:startVerify', () => startVerify())
  ipcMain.handle('storage:previewPrune', (_event, fraction: number) => previewPrune(fraction))
  ipcMain.handle('storage:startPrune', (_event, fraction: number) => startPrune(fraction))
}
