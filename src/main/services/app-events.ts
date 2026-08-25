import { EventEmitter } from 'events'
import type { ScriptHookEvent } from './scripts/types'

/**
 * 主进程内部事件总线。下载 / 分析 / 录播在完成点 emit，脚本钩子在另一头听。
 * 这个文件不能 import 脚本运行时，避免和 downloader 形成循环依赖。
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
}

export const appEvents = new AppEvents()
appEvents.setMaxListeners(50)
