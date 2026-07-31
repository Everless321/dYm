import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { createScriptApi, ScriptCancelledError } from './api'
import { loadScript } from './loader'
import type { ScriptApi, ScriptLogEntry, ScriptRunResult } from './types'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/** 每个脚本保留的日志条数上限 */
const LOG_BUFFER_SIZE = 1000

/** 正在运行的脚本 id，用于阻止同一脚本并发执行 */
const running = new Set<string>()

/** 运行中脚本的中断控制器，「停止」按钮据此发起协作式取消 */
const controllers = new Map<string, AbortController>()

/**
 * 包一层代理：任何 api 调用前先检查是否已被停止。
 * JS 无法强行中断执行中的代码，只能在脚本主动交出控制权（调 api / await）时中断。
 */
function withCancelGuard<T extends object>(target: T, check: () => void): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver)
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          check()
          return (value as (...a: unknown[]) => unknown).apply(obj, args)
        }
      }
      if (value && typeof value === 'object') return withCancelGuard(value as object, check)
      return value
    }
  })
}

/**
 * 按脚本缓存运行日志。
 * 日志必须存在主进程：渲染层页面一卸载 state 就没了，而脚本仍在后台继续跑。
 */
const logBuffers = new Map<string, ScriptLogEntry[]>()

/** 全局自增序号，供渲染层去重与排序 */
let logSeq = 0

function recordAndBroadcast(entry: ScriptLogEntry): void {
  const buffer = logBuffers.get(entry.scriptId) ?? []
  buffer.push(entry)
  if (buffer.length > LOG_BUFFER_SIZE) buffer.splice(0, buffer.length - LOG_BUFFER_SIZE)
  logBuffers.set(entry.scriptId, buffer)

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('scripts:log', entry)
  })
}

/** 取某个脚本的历史日志，页面挂载时用来恢复运行记录 */
export function getScriptLogs(scriptId: string): ScriptLogEntry[] {
  return logBuffers.get(scriptId) ?? []
}

/** 清空某个脚本的日志 */
export function clearScriptLogs(scriptId: string): void {
  logBuffers.delete(scriptId)
}

/**
 * 请求停止脚本。返回是否确实在运行。
 * 脚本会在下一次调用 api 或从 sleep/await 恢复时中断。
 */
export function stopScript(id: string): boolean {
  const controller = controllers.get(id)
  if (!controller || controller.signal.aborted) return false
  controller.abort()
  return true
}

/** 广播当前运行中的脚本列表，让任意时刻挂载的页面都能拿到真实状态 */
function broadcastRunning(): void {
  const list = [...running]
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('scripts:running', list)
  })
}

/** run() 的返回值可能含不可序列化内容，IPC 前先过一遍 JSON */
function toSerializable(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return undefined
  }
}

export function isScriptRunning(id: string): boolean {
  return running.has(id)
}

export function getRunningScripts(): string[] {
  return [...running]
}

/**
 * 执行脚本：加载模块 → 注入 api → 带超时运行 → 回传结果。
 * 运行期间的 api.log 输出通过 'scripts:log' 实时推给渲染层。
 */
export async function runScript(id: string): Promise<ScriptRunResult> {
  if (running.has(id)) {
    throw new Error('该脚本正在运行中')
  }

  const runId = randomUUID()
  const startedAt = Date.now()
  const emit = (level: 'info' | 'error', message: string): void => {
    recordAndBroadcast({ scriptId: id, runId, seq: ++logSeq, level, message, time: Date.now() })
  }

  const controller = new AbortController()
  controllers.set(id, controller)
  running.add(id)
  broadcastRunning()

  let timedOut = false

  try {
    const script = loadScript(id)
    const timeoutMs = script.meta.timeout ?? DEFAULT_TIMEOUT_MS
    // 代理后每次 api 调用都会先检查中断标记
    const api = withCancelGuard(createScriptApi(emit, controller.signal), () => {
      if (controller.signal.aborted) throw new ScriptCancelledError()
    }) as ScriptApi

    emit('info', `▶ 开始运行「${script.meta.name}」`)

    // 超时同样走 abort，让脚本真正停下而不只是不再等待它
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const result = await script.run(api)
      const durationMs = Date.now() - startedAt
      emit('info', `✔ 运行完成，耗时 ${durationMs} ms`)
      return { runId, ok: true, result: toSerializable(result), durationMs }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt

    if (error instanceof ScriptCancelledError || controller.signal.aborted) {
      const reason = timedOut
        ? `脚本执行超时，已中断（耗时 ${durationMs} ms）`
        : `脚本已停止（耗时 ${durationMs} ms）`
      emit('error', `■ ${reason}`)
      return { runId, ok: false, error: reason, cancelled: true, durationMs }
    }

    const message = (error as Error).message || String(error)
    emit('error', `✖ 运行失败：${message}`)
    return { runId, ok: false, error: message, durationMs }
  } finally {
    controllers.delete(id)
    running.delete(id)
    broadcastRunning()
  }
}
