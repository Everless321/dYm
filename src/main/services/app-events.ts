import { EventEmitter } from 'events'
import type { ScriptHookEvent } from './scripts/types'

/** 用户 / 下载任务的配置变更通知。数据库写入函数在提交后 emit，调度器据此重建 cron */
export interface DataChangeEvents {
  'user:settings-changed': (userId: number) => void
  'user:deleted': (userId: number) => void
  'task:changed': (taskId: number) => void
  'task:deleted': (taskId: number) => void
}

/**
 * 主进程内部事件总线。下载 / 分析 / 录播在完成点 emit，脚本钩子在另一头听；
 * 用户 / 任务配置变更也走这里，让调度器与数据库保持一致而不必让每个写入口都记得去改 cron。
 * 这个文件不能 import 脚本运行时或任何 service，避免和 downloader / scheduler 形成循环依赖。
 */
class AppEvents extends EventEmitter {
  emitHook(event: ScriptHookEvent): void {
    try {
      this.emit('script-hook', event)
    } catch (error) {
      // 钩子监听失败不能当成下载失败，否则业务侧会删掉已经下好的文件
      console.error('[app-events] script-hook 监听失败:', error)
    }
  }

  emitDataChange<K extends keyof DataChangeEvents>(
    event: K,
    ...args: Parameters<DataChangeEvents[K]>
  ): void {
    try {
      this.emit(event, ...args)
    } catch (error) {
      // 监听方（调度器）出错不能让数据库写入本身报错
      console.error(`[app-events] ${event} 监听失败:`, error)
    }
  }

  onDataChange<K extends keyof DataChangeEvents>(event: K, listener: DataChangeEvents[K]): void {
    this.on(event, listener as (...args: unknown[]) => void)
  }
}

export const appEvents = new AppEvents()
appEvents.setMaxListeners(50)
