import { getDatabase } from './connection'

// ============ 脚本定时计划 ============

export interface DbScriptSchedule {
  /** 脚本 id：内置为 builtin:<key>，外部为 external:<文件名> */
  script_id: string
  cron: string
  enabled: number
}

export function getScriptSchedules(): DbScriptSchedule[] {
  return getDatabase()
    .prepare('SELECT * FROM script_schedules ORDER BY script_id')
    .all() as DbScriptSchedule[]
}

export function getScriptSchedule(scriptId: string): DbScriptSchedule | null {
  const row = getDatabase()
    .prepare('SELECT * FROM script_schedules WHERE script_id = ?')
    .get(scriptId) as DbScriptSchedule | undefined
  return row ?? null
}

/** 写入或覆盖某个脚本的定时计划 */
export function setScriptSchedule(scriptId: string, cron: string, enabled: boolean): void {
  getDatabase()
    .prepare(
      `INSERT INTO script_schedules (script_id, cron, enabled) VALUES (?, ?, ?)
       ON CONFLICT(script_id) DO UPDATE SET cron = excluded.cron, enabled = excluded.enabled`
    )
    .run(scriptId, cron, enabled ? 1 : 0)
}

export function deleteScriptSchedule(scriptId: string): void {
  getDatabase().prepare('DELETE FROM script_schedules WHERE script_id = ?').run(scriptId)
}

/** 脚本改名后计划要跟着走，否则计划会挂在一个不存在的 id 上 */
export function renameScriptSchedule(fromId: string, toId: string): void {
  const database = getDatabase()
  database.prepare('DELETE FROM script_schedules WHERE script_id = ?').run(toId)
  database
    .prepare('UPDATE script_schedules SET script_id = ? WHERE script_id = ?')
    .run(toId, fromId)
}

// ============ 脚本钩子开关 ============

export interface DbScriptHookSetting {
  script_id: string
  enabled: number
}

/** 没写过设置视为开启：创建时选了钩子就该立刻生效 */
export function isScriptHookEnabled(scriptId: string): boolean {
  const row = getDatabase()
    .prepare('SELECT enabled FROM script_hook_settings WHERE script_id = ?')
    .get(scriptId) as { enabled: number } | undefined
  return row ? row.enabled === 1 : true
}

export function setScriptHookEnabled(scriptId: string, enabled: boolean): void {
  getDatabase()
    .prepare(
      `INSERT INTO script_hook_settings (script_id, enabled) VALUES (?, ?)
       ON CONFLICT(script_id) DO UPDATE SET enabled = excluded.enabled`
    )
    .run(scriptId, enabled ? 1 : 0)
}

export function deleteScriptHookSetting(scriptId: string): void {
  getDatabase().prepare('DELETE FROM script_hook_settings WHERE script_id = ?').run(scriptId)
}

export function renameScriptHookSetting(fromId: string, toId: string): void {
  const database = getDatabase()
  database.prepare('DELETE FROM script_hook_settings WHERE script_id = ?').run(toId)
  database
    .prepare('UPDATE script_hook_settings SET script_id = ? WHERE script_id = ?')
    .run(toId, fromId)
}

// ============ 脚本日志留存 ============

export const DEFAULT_SCRIPT_LOG_LIMIT = 1000
export const MIN_SCRIPT_LOG_LIMIT = 50
export const MAX_SCRIPT_LOG_LIMIT = 20000

export function clampScriptLogLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SCRIPT_LOG_LIMIT
  return Math.min(MAX_SCRIPT_LOG_LIMIT, Math.max(MIN_SCRIPT_LOG_LIMIT, Math.floor(value)))
}

export function getScriptLogLimit(scriptId: string): number {
  const row = getDatabase()
    .prepare('SELECT log_limit FROM script_log_settings WHERE script_id = ?')
    .get(scriptId) as { log_limit: number } | undefined
  return row ? clampScriptLogLimit(row.log_limit) : DEFAULT_SCRIPT_LOG_LIMIT
}

export function setScriptLogLimit(scriptId: string, limit: number): number {
  const logLimit = clampScriptLogLimit(limit)
  getDatabase()
    .prepare(
      `INSERT INTO script_log_settings (script_id, log_limit) VALUES (?, ?)
       ON CONFLICT(script_id) DO UPDATE SET log_limit = excluded.log_limit`
    )
    .run(scriptId, logLimit)
  return logLimit
}

export function deleteScriptLogSetting(scriptId: string): void {
  getDatabase().prepare('DELETE FROM script_log_settings WHERE script_id = ?').run(scriptId)
}

export function renameScriptLogSetting(fromId: string, toId: string): void {
  const database = getDatabase()
  database.prepare('DELETE FROM script_log_settings WHERE script_id = ?').run(toId)
  database
    .prepare('UPDATE script_log_settings SET script_id = ? WHERE script_id = ?')
    .run(toId, fromId)
}
