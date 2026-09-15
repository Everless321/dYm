import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { createScriptApi, ScriptCancelledError } from './api'
import { getScriptLogLimit } from '../../database'
import { loadScript } from './loader'
import {
  appendScriptLogFile,
  deleteLastHookEvent,
  deleteScriptLogFile,
  loadLastHookEvent,
  loadScriptLogFile,
  persistScriptLogFile,
  renameLastHookEvent
} from './log-store'
import {
  HOOK_DEFAULT_TIMEOUT_MS,
  SCRIPT_HOOK_LABELS,
  type ScriptApi,
  type ScriptHookEvent,
  type ScriptLogEntry,
  type ScriptRunResult
} from './types'

/** 正在运行的脚本 id，用于阻止同一脚本并发执行 */
const running = new Set<string>()

/** 同一脚本已在运行时抛出，钩子队列据此决定重试而不是按错误文案匹配 */
export class ScriptBusyError extends Error {
  constructor() {
    super('该脚本正在运行中')
    this.name = 'ScriptBusyError'
  }
}

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
 * 同时落到 userData/script-logs，关掉应用再打开还能看到。
 */
const logBuffers = new Map<string, ScriptLogEntry[]>()

/** 全局自增序号，供渲染层去重与排序 */
let logSeq = 0

/** 留存条数按脚本缓存，否则每写一行日志都要查一次 SQLite */
const logLimitCache = new Map<string, number>()

/**
 * 磁盘上 jsonl 的行数估算（加载时的条数 + 之后追加的条数）。
 * 内存 buffer 每行都裁，但文件只在超过留存上限一倍时才整体重写一次，
 * 否则脚本刷日志（如 tail ffmpeg 进度）时每一行都会触发全文件重写，把主进程卡死。
 */
const logFileLines = new Map<string, number>()

function logLimitOf(scriptId: string): number {
  let limit = logLimitCache.get(scriptId)
  if (limit === undefined) {
    limit = getScriptLogLimit(scriptId)
    logLimitCache.set(scriptId, limit)
  }
  return limit
}

function ensureLogsLoaded(scriptId: string): ScriptLogEntry[] {
  let buffer = logBuffers.get(scriptId)
  if (!buffer) {
    buffer = loadScriptLogFile(scriptId, logLimitOf(scriptId))
    logBuffers.set(scriptId, buffer)
    logFileLines.set(scriptId, buffer.length)
    for (const entry of buffer) {
      if (entry.seq > logSeq) logSeq = entry.seq
    }
  }
  return buffer
}

function persistTrimmed(scriptId: string, buffer: ScriptLogEntry[]): void {
  try {
    persistScriptLogFile(scriptId, buffer)
    logFileLines.set(scriptId, buffer.length)
  } catch (error) {
    console.error('[scripts] 写日志文件失败:', error)
  }
}

/**
 * 写一条日志：分配序号 → 进内存 → 追加到磁盘 → 推给渲染层。
 * 序号必须在 ensureLogsLoaded 之后分配，否则重启后第一条日志的 seq 会小于磁盘上的历史，
 * 渲染层按 seq 去重时会把它当成旧行覆盖掉。
 */
function recordAndBroadcast(draft: Omit<ScriptLogEntry, 'seq'>): void {
  const buffer = ensureLogsLoaded(draft.scriptId)
  const entry: ScriptLogEntry = { ...draft, seq: ++logSeq }
  buffer.push(entry)
  const limit = logLimitOf(entry.scriptId)
  if (buffer.length > limit) {
    buffer.splice(0, buffer.length - limit)
  }

  const fileLines = (logFileLines.get(entry.scriptId) ?? 0) + 1
  if (fileLines > limit * 2) {
    persistTrimmed(entry.scriptId, buffer)
  } else {
    try {
      appendScriptLogFile(entry)
      logFileLines.set(entry.scriptId, fileLines)
    } catch (error) {
      console.error('[scripts] 写日志文件失败:', error)
    }
  }

  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('scripts:log', entry)
  })
}

/** 取某个脚本的历史日志，页面挂载时用来恢复运行记录 */
export function getScriptLogs(scriptId: string): ScriptLogEntry[] {
  return ensureLogsLoaded(scriptId)
}

/** 清空某个脚本的日志（内存和磁盘一起清） */
export function clearScriptLogs(scriptId: string): void {
  // 先删磁盘再清内存：磁盘删除失败（Windows 上文件被占用）时内存仍与磁盘一致，不会出现「清了又回来」
  deleteScriptLogFile(scriptId)
  logBuffers.delete(scriptId)
  logFileLines.delete(scriptId)
}

/** 脚本改名后日志文件跟着搬，里面的 scriptId 也改掉，否则页面按 id 过滤会看不到 */
export function renameScriptLogs(fromId: string, toId: string): void {
  if (fromId === toId) return
  const entries = ensureLogsLoaded(fromId).map((entry) => ({ ...entry, scriptId: toId }))
  persistScriptLogFile(toId, entries)
  deleteScriptLogFile(fromId)
  logBuffers.delete(fromId)
  logFileLines.delete(fromId)
  logLimitCache.delete(fromId)
  logLimitCache.delete(toId)
  logBuffers.set(toId, entries)
  logFileLines.set(toId, entries.length)
  renameLastHookEvent(fromId, toId)
}

/** 按新的留存条数裁切内存和磁盘。改设置时立刻生效。 */
export function applyScriptLogLimit(scriptId: string, limit: number): void {
  logLimitCache.set(scriptId, limit)
  const buffer = ensureLogsLoaded(scriptId)
  if (buffer.length > limit) {
    buffer.splice(0, buffer.length - limit)
    persistTrimmed(scriptId, buffer)
  }
}

export function forgetScriptRuntime(scriptId: string): void {
  clearScriptLogs(scriptId)
  logLimitCache.delete(scriptId)
  deleteLastHookEvent(scriptId)
}

/**
 * 请求停止脚本。返回该脚本当前是否在运行（重复点停止时仍返回 true，与界面状态一致）。
 * 脚本会在下一次调用 api 或从 sleep/await 恢复时中断。
 */
export function stopScript(id: string): boolean {
  const controller = controllers.get(id)
  if (!controller) return false
  if (!controller.signal.aborted) controller.abort()
  return running.has(id)
}

/** 脚本可以 throw 任意值（null / 字符串 / 对象），统一取一个可读的消息 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

/** meta.timeout 来自用户脚本，可能是字符串 / NaN / 负数，只认有限的非负数 */
function normalizeTimeout(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return value
}

/**
 * 把 AbortSignal 变成一个会 reject 的 Promise，用来和 script.run 赛跑。
 * JS 无法强行中断执行中的代码：脚本若卡在一个不响应 signal 的 await 里
 * （api.actions.syncUser、裸 fetch、new Promise(() => {})），只靠代理里的检查永远等不到。
 * 用赛跑保证「停止 / 超时」一定能让这次运行收尾，哪怕脚本体还在后台继续。
 */
function abortedPromise(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let onAbort: (() => void) | undefined
  const promise = new Promise<never>((_, reject) => {
    onAbort = (): void => reject(new ScriptCancelledError())
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return {
    promise,
    dispose: (): void => {
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
  }
}

/** 广播当前运行中的脚本列表，让任意时刻挂载的页面都能拿到真实状态 */
function broadcastRunning(): void {
  const list = [...running]
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send('scripts:running', list)
  })
}

/** 把毫秒转成便于阅读的时长，长任务可能跑几十小时 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分 ${seconds} 秒`
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
  return `${seconds} 秒`
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

/** 给钩子队列溢出等不在一次 run 里的提示用 */
export function appendScriptLog(scriptId: string, level: 'info' | 'error', message: string): void {
  recordAndBroadcast({ scriptId, runId: 'system', level, message, time: Date.now() })
}

type ExecuteKind =
  | { kind: 'manual'; replayLastHook: boolean }
  | { kind: 'hook'; event: ScriptHookEvent }

export interface RunScriptOptions {
  /**
   * 钩子脚本手动运行时是否带上上次触发的入参（页面上的「再次执行」）。
   * 定时执行必须传 false：cron 每次 tick 都重放同一条 post.downloaded，会把同一个作品反复处理。
   */
  replayLastHook?: boolean
}

/**
 * 执行脚本：加载模块 → 注入 api → 带超时运行 → 回传结果。
 * 运行期间的 api.log 输出通过 'scripts:log' 实时推给渲染层。
 */
export async function runScript(
  id: string,
  options: RunScriptOptions = {}
): Promise<ScriptRunResult> {
  return executeScript(id, { kind: 'manual', replayLastHook: options.replayLastHook ?? true })
}

/** 由钩子调度器调用。同一脚本正在跑时不要调这个，先排队 */
export async function runScriptHook(id: string, event: ScriptHookEvent): Promise<ScriptRunResult> {
  return executeScript(id, { kind: 'hook', event })
}

async function executeScript(id: string, options: ExecuteKind): Promise<ScriptRunResult> {
  if (running.has(id)) {
    throw new ScriptBusyError()
  }

  const runId = randomUUID()
  const startedAt = Date.now()
  const emit = (level: 'info' | 'error', message: string): void => {
    recordAndBroadcast({ scriptId: id, runId, level, message, time: Date.now() })
  }

  const controller = new AbortController()
  controllers.set(id, controller)
  running.add(id)
  broadcastRunning()

  let timedOut = false
  let bodySettled = false

  try {
    const script = loadScript(id)
    // 代理后每次 api 调用都会先检查中断标记
    const api = withCancelGuard(createScriptApi(emit, controller.signal), () => {
      if (controller.signal.aborted) throw new ScriptCancelledError()
    }) as ScriptApi

    let event: ScriptHookEvent | undefined = options.kind === 'hook' ? options.event : undefined
    let replayed = false
    if (options.kind === 'manual' && options.replayLastHook && script.meta.hook) {
      const last = loadLastHookEvent(id)
      if (last && last.hook === script.meta.hook) {
        event = last
        replayed = true
      }
    }

    const startLine =
      options.kind === 'hook'
        ? `⚡ 钩子「${SCRIPT_HOOK_LABELS[options.event.hook]}」触发「${script.meta.name}」`
        : replayed && event
          ? `▶ 再次执行「${script.meta.name}」（上次的${SCRIPT_HOOK_LABELS[event.hook]}入参）`
          : `▶ 开始运行「${script.meta.name}」`
    emit('info', startLine)

    // 钩子（含页面上用上次入参再跑）默认 10 分钟；纯手动仍默认不限。
    const timeoutMs = normalizeTimeout(script.meta.timeout, event ? HOOK_DEFAULT_TIMEOUT_MS : 0)
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            controller.abort()
          }, timeoutMs)
        : undefined

    const aborted = abortedPromise(controller.signal)
    try {
      const body = Promise.resolve()
        .then(() => script.run(api, event))
        .finally(() => {
          bodySettled = true
        })
      // 脚本体自己 reject 时 race 已经结束，这里只是避免 body 变成 unhandledRejection
      body.catch(() => undefined)
      const result = await Promise.race([body, aborted.promise])
      const durationMs = Date.now() - startedAt
      emit('info', `✔ 运行完成，耗时 ${formatDuration(durationMs)}`)
      return { runId, ok: true, result: toSerializable(result), durationMs }
    } finally {
      aborted.dispose()
      if (timer) clearTimeout(timer)
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt

    if (error instanceof ScriptCancelledError || controller.signal.aborted) {
      const reason = timedOut
        ? `脚本执行超时，已中断（耗时 ${formatDuration(durationMs)}）`
        : `脚本已停止（耗时 ${formatDuration(durationMs)}）`
      emit('error', `■ ${reason}`)
      if (!bodySettled) {
        emit('error', '⚠ 脚本未响应停止信号，脚本体可能仍在后台执行直到它自己结束')
      }
      return { runId, ok: false, error: reason, cancelled: true, durationMs }
    }

    const message = messageOf(error)
    emit('error', `✖ 运行失败：${message}`)
    return { runId, ok: false, error: message, durationMs }
  } finally {
    controllers.delete(id)
    running.delete(id)
    broadcastRunning()
  }
}
