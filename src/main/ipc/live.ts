import { ipcMain, shell } from 'electron'
import { getLiveRecords, deleteLiveRecord } from '../database'
import {
  checkAndRecordUser,
  stopLiveRecording,
  isRecordingLive,
  getRecordingUserIds
} from '../services/live-recorder'
import { preparePlayback, getDanmaku } from '../services/live-playback'
import { getConvertingIds } from '../services/live-convert'
import { syncUserSchedules } from '../services/scheduler'
import { createLivePlayerWindow } from '../windows/live-player'

export function registerLiveIpc(): void {
  // Live recording IPC handlers
  ipcMain.handle('live:isRecording', (_event, userId: number) => isRecordingLive(userId))
  ipcMain.handle('live:getRecordingUsers', () => getRecordingUserIds())
  ipcMain.handle('live:getConvertingIds', () => getConvertingIds())
  ipcMain.handle('live:checkNow', (_event, userId: number) => checkAndRecordUser(userId))
  ipcMain.handle('live:stop', (_event, userId: number) => stopLiveRecording(userId))
  ipcMain.handle('live:getRecords', (_event, limit?: number) => getLiveRecords(limit))
  // 为回放准备可原生播放的视频（FLV -> MP4 转封装，缓存复用）
  ipcMain.handle('live:preparePlayback', (_event, id: number) => preparePlayback(id))
  ipcMain.handle('live:getDanmaku', (_event, id: number) => getDanmaku(id))
  // 打开独立播放窗口（左视频右弹幕）
  ipcMain.handle('live:openPlayer', (_event, id: number) => {
    createLivePlayerWindow(id)
  })
  ipcMain.handle('live:deleteRecord', (_event, id: number) => deleteLiveRecord(id))
  ipcMain.handle('live:revealFile', (_event, filePath: string) => {
    if (filePath) shell.showItemInFolder(filePath)
  })
  // 调度重建已由数据库变更事件自动完成；保留通道给旧调用方，按库里最新配置幂等重建
  ipcMain.handle('live:updateUserSchedule', (_event, userId: number) => syncUserSchedules(userId))
}
