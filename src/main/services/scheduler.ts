import cron, { type ScheduledTask as CronScheduledTask } from 'node-cron'
import { BrowserWindow } from 'electron'
import { getAutoSyncUsers, getAutoSyncTasks, updateTaskLastSyncAt, type DbUser, type DbTaskWithUsers } from '../database'
import { startUserSync, isUserSyncing, getAnyUserSyncing } from './syncer'
import { startDownloadTask, isTaskRunning } from './downloader'

export interface SchedulerLog {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  message: string
  type: 'user' | 'task' | 'system'
  targetName?: string
}

const MAX_LOG_BUFFER_SIZE = 500
const logBuffer: SchedulerLog[] = []

function sendSchedulerLog(log: Omit<SchedulerLog, 'timestamp'>): void {
  const fullLog: SchedulerLog = { ...log, timestamp: Date.now() }

  // 保存到缓冲区
  logBuffer.unshift(fullLog)
  if (logBuffer.length > MAX_LOG_BUFFER_SIZE) {
    logBuffer.pop()
  }

  // 发送到前端
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('scheduler:log', fullLog)
  }

  // 输出到终端
  const prefix = `[Scheduler]`
  const msg = log.targetName ? `${log.message} (${log.targetName})` : log.message
  if (log.level === 'error') {
    console.error(prefix, msg)
  } else if (log.level === 'warn') {
    console.warn(prefix, msg)
  } else {
    console.log(prefix, msg)
  }
}

export function getSchedulerLogs(): SchedulerLog[] {
  return [...logBuffer]
}

export function clearSchedulerLogs(): void {
  logBuffer.length = 0
}

interface ScheduledUserTask {
  userId: number
  task: CronScheduledTask
}

interface ScheduledDownloadTask {
  taskId: number
  task: CronScheduledTask
}

const scheduledUserTasks: Map<number, ScheduledUserTask> = new Map()
const scheduledDownloadTasks: Map<number, ScheduledDownloadTask> = new Map()

function isValidCron(expression: string): boolean {
  return cron.validate(expression)
}

async function executeUserSync(user: DbUser): Promise<void> {
  if (isUserSyncing(user.id)) {
    sendSchedulerLog({ level: 'warn', message: '用户正在同步中，跳过', type: 'user', targetName: user.nickname })
    return
  }

  const currentSyncing = getAnyUserSyncing()
  if (currentSyncing !== null) {
    sendSchedulerLog({ level: 'warn', message: '其他用户正在同步，跳过', type: 'user', targetName: user.nickname })
    return
  }

  sendSchedulerLog({ level: 'info', message: '开始定时同步', type: 'user', targetName: user.nickname })
  try {
    await startUserSync(user.id)
    sendSchedulerLog({ level: 'info', message: '定时同步完成', type: 'user', targetName: user.nickname })
  } catch (error) {
    sendSchedulerLog({ level: 'error', message: `同步失败: ${(error as Error).message}`, type: 'user', targetName: user.nickname })
  }
}

export function scheduleUser(user: DbUser): void {
  if (scheduledUserTasks.has(user.id)) {
    unscheduleUser(user.id)
  }

  if (!user.auto_sync || !user.sync_cron) {
    return
  }

  if (!isValidCron(user.sync_cron)) {
    sendSchedulerLog({ level: 'error', message: `无效的 Cron 表达式: ${user.sync_cron}`, type: 'user', targetName: user.nickname })
    return
  }

  const task = cron.schedule(user.sync_cron, () => {
    executeUserSync(user)
  })

  scheduledUserTasks.set(user.id, { userId: user.id, task })
  sendSchedulerLog({ level: 'info', message: `已注册定时同步 (${user.sync_cron})`, type: 'user', targetName: user.nickname })
}

export function unscheduleUser(userId: number): void {
  const scheduled = scheduledUserTasks.get(userId)
  if (scheduled) {
    scheduled.task.stop()
    scheduledUserTasks.delete(userId)
    sendSchedulerLog({ level: 'info', message: `已取消定时同步 (用户ID: ${userId})`, type: 'user' })
  }
}

// Task scheduling functions
async function executeTaskDownload(task: DbTaskWithUsers): Promise<void> {
  if (isTaskRunning(task.id)) {
    sendSchedulerLog({ level: 'warn', message: '任务正在运行中，跳过', type: 'task', targetName: task.name })
    return
  }

  sendSchedulerLog({ level: 'info', message: '开始定时下载', type: 'task', targetName: task.name })
  try {
    await startDownloadTask(task.id)
    updateTaskLastSyncAt(task.id)
    sendSchedulerLog({ level: 'info', message: '定时下载完成', type: 'task', targetName: task.name })
  } catch (error) {
    sendSchedulerLog({ level: 'error', message: `执行失败: ${(error as Error).message}`, type: 'task', targetName: task.name })
  }
}

export function scheduleTask(task: DbTaskWithUsers): void {
  if (scheduledDownloadTasks.has(task.id)) {
    unscheduleTask(task.id)
  }

  if (!task.auto_sync || !task.sync_cron) {
    return
  }

  if (!isValidCron(task.sync_cron)) {
    sendSchedulerLog({ level: 'error', message: `无效的 Cron 表达式: ${task.sync_cron}`, type: 'task', targetName: task.name })
    return
  }

  const cronTask = cron.schedule(task.sync_cron, () => {
    executeTaskDownload(task)
  })

  scheduledDownloadTasks.set(task.id, { taskId: task.id, task: cronTask })
  sendSchedulerLog({ level: 'info', message: `已注册定时下载 (${task.sync_cron})`, type: 'task', targetName: task.name })
}

export function unscheduleTask(taskId: number): void {
  const scheduled = scheduledDownloadTasks.get(taskId)
  if (scheduled) {
    scheduled.task.stop()
    scheduledDownloadTasks.delete(taskId)
    sendSchedulerLog({ level: 'info', message: `已取消定时下载 (任务ID: ${taskId})`, type: 'task' })
  }
}

export function initScheduler(): void {
  // Initialize user-level scheduling
  const users = getAutoSyncUsers()
  sendSchedulerLog({ level: 'info', message: `初始化完成，${users.length} 个用户自动同步`, type: 'system' })
  for (const user of users) {
    scheduleUser(user)
  }

  // Initialize task-level scheduling
  const tasks = getAutoSyncTasks()
  sendSchedulerLog({ level: 'info', message: `初始化完成，${tasks.length} 个任务自动同步`, type: 'system' })
  for (const task of tasks) {
    scheduleTask(task)
  }
}

export function stopScheduler(): void {
  for (const [userId] of scheduledUserTasks) {
    unscheduleUser(userId)
  }
  for (const [taskId] of scheduledDownloadTasks) {
    unscheduleTask(taskId)
  }
  sendSchedulerLog({ level: 'info', message: '所有定时任务已停止', type: 'system' })
}

export function getScheduledUserIds(): number[] {
  return Array.from(scheduledUserTasks.keys())
}

export function getScheduledTaskIds(): number[] {
  return Array.from(scheduledDownloadTasks.keys())
}

export function validateCronExpression(expression: string): boolean {
  return isValidCron(expression)
}
