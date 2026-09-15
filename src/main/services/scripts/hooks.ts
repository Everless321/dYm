import { isScriptHookEnabled } from '../../database'
import { appEvents } from '../app-events'
import { listScripts } from './loader'
import { saveLastHookEvent } from './log-store'
import { appendScriptLog, isScriptRunning, runScriptHook, ScriptBusyError } from './runner'
import type { ScriptDescriptor, ScriptHookEvent, ScriptHookName } from './types'

const QUEUE_LIMIT = 50

/** 钩子名 → 订阅了它的外部脚本 id。内置范例不进索引，复制后才会自动跑 */
let index = new Map<ScriptHookName, string[]>()

/** 脚本当前挂的钩子，drain 时用来丢掉过期队列项 */
const scriptHookOf = new Map<string, ScriptHookName>()

/** 每个脚本一条 FIFO。下载循环里只入队不 await */
const queues = new Map<string, ScriptHookEvent[]>()

const draining = new Set<string>()

let started = false

function isBuiltin(scriptId: string): boolean {
  return scriptId.startsWith('builtin:')
}

function cloneEvent(event: ScriptHookEvent): ScriptHookEvent {
  return structuredClone(event)
}

function removeFromIndex(scriptId: string): void {
  scriptHookOf.delete(scriptId)
  for (const [hook, ids] of index) {
    const next = ids.filter((id) => id !== scriptId)
    if (next.length === 0) index.delete(hook)
    else index.set(hook, next)
  }
}

function shouldIndex(desc: ScriptDescriptor): desc is ScriptDescriptor & { hook: ScriptHookName } {
  return !desc.error && !!desc.hook && !isBuiltin(desc.id)
}

export function syncScriptHookIndex(desc: ScriptDescriptor): void {
  const previous = scriptHookOf.get(desc.id)
  removeFromIndex(desc.id)
  if (!shouldIndex(desc)) {
    if (previous) clearScriptHookQueue(desc.id)
    return
  }
  if (previous && previous !== desc.hook) clearScriptHookQueue(desc.id)
  const ids = index.get(desc.hook) ?? []
  if (!ids.includes(desc.id)) ids.push(desc.id)
  index.set(desc.hook, ids)
  scriptHookOf.set(desc.id, desc.hook)
}

export function dropScriptHookIndex(scriptId: string): void {
  removeFromIndex(scriptId)
  clearScriptHookQueue(scriptId)
}

export function rebuildScriptHookIndex(list: ScriptDescriptor[]): void {
  const next = new Map<ScriptHookName, string[]>()
  const nextOf = new Map<string, ScriptHookName>()
  for (const item of list) {
    if (!shouldIndex(item)) continue
    const ids = next.get(item.hook) ?? []
    ids.push(item.id)
    next.set(item.hook, ids)
    nextOf.set(item.id, item.hook)
  }
  index = next
  scriptHookOf.clear()
  for (const [id, hook] of nextOf) scriptHookOf.set(id, hook)
}

/** 清空队列数组本身，drain 里拿到的是同一引用，停止后不会把已取消的事件塞回去 */
export function clearScriptHookQueue(scriptId: string): void {
  const queue = queues.get(scriptId)
  if (queue) queue.length = 0
  queues.delete(scriptId)
}

function enqueue(scriptId: string, event: ScriptHookEvent): void {
  const queue = queues.get(scriptId) ?? []
  if (queue.length >= QUEUE_LIMIT) {
    queue.shift()
    appendScriptLog(
      scriptId,
      'error',
      `钩子队列已满（${QUEUE_LIMIT}），丢掉最老的一条 ${event.hook}`
    )
  }
  queue.push(cloneEvent(event))
  queues.set(scriptId, queue)
  drain(scriptId).catch((error) => {
    console.error(`[scripts] 钩子队列 ${scriptId} 处理失败:`, error)
  })
}

async function drain(scriptId: string): Promise<void> {
  if (draining.has(scriptId)) return
  draining.add(scriptId)
  try {
    while (true) {
      const queue = queues.get(scriptId)
      if (!queue || queue.length === 0) return

      if (isScriptRunning(scriptId)) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
        continue
      }

      const event = queue.shift()
      if (!event) return
      if (queue.length === 0) queues.delete(scriptId)

      // 一条事件出错只影响这一条；数据库 / 日志文件短暂不可用不能让整条队列静默丢掉
      try {
        if (!isScriptHookEnabled(scriptId) || scriptHookOf.get(scriptId) !== event.hook) {
          continue
        }

        try {
          saveLastHookEvent(scriptId, event)
        } catch (error) {
          console.error('[scripts] 保存上次钩子入参失败:', error)
        }

        try {
          await runScriptHook(scriptId, event)
        } catch (error) {
          if (error instanceof ScriptBusyError) {
            // 与手动运行撞上：放回队首，稍后再试
            const rest = queues.get(scriptId) ?? []
            rest.unshift(event)
            queues.set(scriptId, rest)
            await new Promise<void>((resolve) => setTimeout(resolve, 250))
            continue
          }
          appendScriptLog(scriptId, 'error', `钩子调度失败：${(error as Error).message}`)
        }
      } catch (error) {
        console.error(`[scripts] 处理钩子 ${event.hook} → ${scriptId} 失败:`, error)
      }
    }
  } finally {
    draining.delete(scriptId)
    if ((queues.get(scriptId)?.length ?? 0) > 0 && !draining.has(scriptId)) {
      drain(scriptId).catch((error) => {
        console.error(`[scripts] 钩子队列 ${scriptId} 处理失败:`, error)
      })
    }
  }
}

function dispatch(event: ScriptHookEvent): void {
  const ids = index.get(event.hook)
  if (!ids || ids.length === 0) return
  for (const scriptId of ids) {
    try {
      if (!isScriptHookEnabled(scriptId)) continue
      enqueue(scriptId, event)
    } catch (error) {
      console.error(`[scripts] 派发 ${event.hook} 给 ${scriptId} 失败:`, error)
    }
  }
}

/** 应用启动时听内部事件总线，并按当前脚本列表建索引 */
export function startScriptHooks(): void {
  if (started) return
  started = true
  rebuildScriptHookIndex(listScripts())
  appEvents.on('script-hook', (event: ScriptHookEvent) => {
    dispatch(event)
  })
}
