import { isScriptHookEnabled } from '../../database'
import { appEvents } from '../app-events'
import { listScripts } from './loader'
import { saveLastHookEvent } from './log-store'
import { appendScriptLog, isScriptRunning, runScriptHook } from './runner'
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
  void drain(scriptId)
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

      if (!isScriptHookEnabled(scriptId) || scriptHookOf.get(scriptId) !== event.hook) {
        continue
      }

      try {
        try {
          saveLastHookEvent(scriptId, event)
        } catch (error) {
          console.error('[scripts] 保存上次钩子入参失败:', error)
        }
        await runScriptHook(scriptId, event)
      } catch (error) {
        if ((error as Error).message === '该脚本正在运行中') {
          const rest = queues.get(scriptId)
          if (!rest) continue
          rest.unshift(event)
          await new Promise<void>((resolve) => setTimeout(resolve, 250))
          continue
        }
        appendScriptLog(scriptId, 'error', `钩子调度失败：${(error as Error).message}`)
      }
    }
  } finally {
    draining.delete(scriptId)
    if ((queues.get(scriptId)?.length ?? 0) > 0 && !draining.has(scriptId)) {
      void drain(scriptId)
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
