import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import type { ScriptHookEvent, ScriptLogEntry } from './types'

/** 没单独设置时每个脚本留这么多条 */
export const SCRIPT_LOG_LIMIT = 1000

function getLogDir(): string {
  return join(app.getPath('userData'), 'script-logs')
}

function logFileName(scriptId: string): string {
  return `${scriptId.replace(/[^a-zA-Z0-9._-]+/g, '_')}.jsonl`
}

function getLogPath(scriptId: string): string {
  return join(getLogDir(), logFileName(scriptId))
}

function ensureLogDir(): string {
  const dir = getLogDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function isLogEntry(value: unknown, scriptId: string): value is ScriptLogEntry {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<ScriptLogEntry>
  return (
    row.scriptId === scriptId &&
    typeof row.runId === 'string' &&
    typeof row.seq === 'number' &&
    (row.level === 'info' || row.level === 'error') &&
    typeof row.message === 'string' &&
    typeof row.time === 'number'
  )
}

/** 从磁盘读回该脚本的日志。文件坏掉或没有就当空的，不抛给运行路径 */
export function loadScriptLogFile(scriptId: string, limit?: number): ScriptLogEntry[] {
  const filePath = getLogPath(scriptId)
  if (!existsSync(filePath)) return []
  let text = ''
  try {
    text = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }
  const entries: ScriptLogEntry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isLogEntry(parsed, scriptId)) entries.push(parsed)
    } catch {
      // 半截行丢掉
    }
  }
  return entries.slice(-(limit ?? SCRIPT_LOG_LIMIT))
}

export function appendScriptLogFile(entry: ScriptLogEntry): void {
  ensureLogDir()
  appendFileSync(getLogPath(entry.scriptId), `${JSON.stringify(entry)}\n`, 'utf-8')
}

/** 内存裁切之后整文件重写，避免 jsonl 无限涨 */
export function persistScriptLogFile(scriptId: string, entries: ScriptLogEntry[]): void {
  ensureLogDir()
  const body = entries.map((entry) => JSON.stringify(entry)).join('\n')
  writeFileSync(getLogPath(scriptId), body ? `${body}\n` : '', 'utf-8')
}

export function deleteScriptLogFile(scriptId: string): void {
  rmSync(getLogPath(scriptId), { force: true })
}

function lastEventPath(scriptId: string): string {
  return join(getLogDir(), `${logFileName(scriptId).replace(/\.jsonl$/, '')}.last.json`)
}

export function saveLastHookEvent(scriptId: string, event: ScriptHookEvent): void {
  ensureLogDir()
  writeFileSync(lastEventPath(scriptId), `${JSON.stringify(event)}\n`, 'utf-8')
}

export function loadLastHookEvent(scriptId: string): ScriptHookEvent | null {
  const filePath = lastEventPath(scriptId)
  if (!existsSync(filePath)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return null
    const hook = (parsed as { hook?: unknown }).hook
    if (typeof hook !== 'string') return null
    return parsed as ScriptHookEvent
  } catch {
    return null
  }
}

export function hasLastHookEvent(scriptId: string): boolean {
  return existsSync(lastEventPath(scriptId))
}

export function deleteLastHookEvent(scriptId: string): void {
  rmSync(lastEventPath(scriptId), { force: true })
}

export function renameLastHookEvent(fromId: string, toId: string): void {
  if (fromId === toId) return
  const event = loadLastHookEvent(fromId)
  deleteLastHookEvent(fromId)
  if (event) saveLastHookEvent(toId, event)
}
