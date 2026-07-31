import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { createScriptApi } from './api'
import { loadScript } from './loader'
import type { ScriptLogEntry, ScriptRunResult } from './types'

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/** 每个脚本保留的日志条数上限 */
const LOG_BUFFER_SIZE = 1000

/** 正在运行的脚本 id，用于阻止同一脚本并发执行 */
const running = new Set<string>()

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

  running.add(id)
  broadcastRunning()
  try {
    const script = loadScript(id)
    const timeoutMs = script.meta.timeout ?? DEFAULT_TIMEOUT_MS
    const api = createScriptApi(emit)

    emit('info', `▶ 开始运行「${script.meta.name}」`)

    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`脚本执行超时（${Math.round(timeoutMs / 1000)} 秒）`)),
        timeoutMs
      )
    })

    try {
      const result = await Promise.race([Promise.resolve(script.run(api)), timeout])
      const durationMs = Date.now() - startedAt
      emit('info', `✔ 运行完成，耗时 ${durationMs} ms`)
      return { runId, ok: true, result: toSerializable(result), durationMs }
    } finally {
      if (timer) clearTimeout(timer)
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const message = (error as Error).message || String(error)
    emit('error', `✖ 运行失败：${message}`)
    return { runId, ok: false, error: message, durationMs }
  } finally {
    running.delete(id)
    broadcastRunning()
  }
}
