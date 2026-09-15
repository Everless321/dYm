import { ipcMain } from 'electron'
import {
  createTask,
  getTaskById,
  getAllTasks,
  updateTask,
  updateTaskUsers,
  deleteTask,
  type DbTask,
  type CreateTaskInput
} from '../database'
import { startDownloadTask, stopDownloadTask, isTaskRunning } from '../services/downloader'
import {
  startUserSync,
  stopUserSync,
  isUserSyncing,
  getAnyUserSyncing,
  getAllSyncingUserIds
} from '../services/syncer'
import {
  syncUserSchedules,
  syncTaskSchedule,
  validateCronExpression,
  getSchedulerLogs,
  clearSchedulerLogs,
  scheduleCollectSync,
  executeCollectSync
} from '../services/scheduler'

export function registerTaskIpc(): void {
  // Task IPC handlers
  ipcMain.handle('task:getAll', () => getAllTasks())
  ipcMain.handle('task:getById', (_event, id: number) => getTaskById(id))
  ipcMain.handle('task:create', (_event, input: CreateTaskInput) => createTask(input))
  ipcMain.handle(
    'task:update',
    (
      _event,
      id: number,
      input: Partial<{
        name: string
        status: string
        concurrency: number
        auto_sync: boolean
        sync_cron: string
      }>
    ) => {
      const dbInput: Parameters<typeof updateTask>[1] = {}
      if (input.name !== undefined) dbInput.name = input.name
      if (input.status !== undefined) dbInput.status = input.status as DbTask['status']
      if (input.concurrency !== undefined) dbInput.concurrency = input.concurrency
      if (input.auto_sync !== undefined) dbInput.auto_sync = input.auto_sync ? 1 : 0
      if (input.sync_cron !== undefined) dbInput.sync_cron = input.sync_cron
      return updateTask(id, dbInput)
    }
  )
  ipcMain.handle('task:updateUsers', (_event, taskId: number, userIds: number[]) =>
    updateTaskUsers(taskId, userIds)
  )
  ipcMain.handle('task:delete', (_event, id: number) => {
    if (isTaskRunning(id)) stopDownloadTask(id)
    deleteTask(id)
  })

  // Download IPC handlers
  ipcMain.handle('download:start', (_event, taskId: number) => {
    return startDownloadTask(taskId, { source: 'manual' })
  })
  ipcMain.handle('download:stop', (_event, taskId: number) => stopDownloadTask(taskId))
  ipcMain.handle('download:isRunning', (_event, taskId: number) => isTaskRunning(taskId))

  // Sync IPC handlers
  ipcMain.handle('sync:start', (_event, userId: number) =>
    startUserSync(userId, { source: 'manual' })
  )
  ipcMain.handle('sync:stop', (_event, userId: number) => stopUserSync(userId))
  ipcMain.handle('sync:isRunning', (_event, userId: number) => isUserSyncing(userId))
  ipcMain.handle('sync:getAnySyncing', () => getAnyUserSyncing())
  ipcMain.handle('sync:getAllSyncing', () => getAllSyncingUserIds())
  ipcMain.handle('sync:validateCron', (_event, expression: string) =>
    validateCronExpression(expression)
  )
  // 调度重建已由数据库变更事件自动完成；保留这两个通道给旧调用方，按库里最新配置幂等重建
  ipcMain.handle('sync:updateUserSchedule', (_event, userId: number) => syncUserSchedules(userId))
  ipcMain.handle('task:updateSchedule', (_event, taskId: number) => syncTaskSchedule(taskId))

  // Scheduler logs IPC handlers
  ipcMain.handle('scheduler:getLogs', () => getSchedulerLogs())
  ipcMain.handle('scheduler:clearLogs', () => clearSchedulerLogs())

  // 收藏同步：保存设置后重建定时任务 / 立即手动触发一次
  ipcMain.handle('collect:reschedule', () => scheduleCollectSync())
  ipcMain.handle('collect:syncNow', () => executeCollectSync())
}
