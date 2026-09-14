import { getDatabase } from './connection'

export interface DbLiveRecord {
  id: number
  user_id: number
  sec_uid: string
  nickname: string | null
  room_id: string
  title: string | null
  quality: string | null
  cover_path: string | null
  file_path: string | null
  file_size: number
  status: 'recording' | 'completed' | 'failed' | 'stopped'
  error: string | null
  started_at: number
  ended_at: number | null
}

export interface CreateLiveRecordInput {
  user_id: number
  sec_uid: string
  nickname?: string
  room_id: string
  title?: string
  quality?: string
  cover_path?: string
  file_path?: string
}

export function createLiveRecord(input: CreateLiveRecordInput): number {
  const database = getDatabase()
  const result = database
    .prepare(
      `INSERT INTO live_records (user_id, sec_uid, nickname, room_id, title, quality, cover_path, file_path, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recording')`
    )
    .run(
      input.user_id,
      input.sec_uid,
      input.nickname || null,
      input.room_id,
      input.title || null,
      input.quality || null,
      input.cover_path || null,
      input.file_path || null
    )
  return result.lastInsertRowid as number
}

export interface UpdateLiveRecordInput {
  status?: DbLiveRecord['status']
  file_path?: string
  file_size?: number
  error?: string
  ended_at?: number
}

export function updateLiveRecord(id: number, input: UpdateLiveRecordInput): void {
  const database = getDatabase()
  const fields: string[] = []
  const values: unknown[] = []
  if (input.status !== undefined) {
    fields.push('status = ?')
    values.push(input.status)
  }
  if (input.file_path !== undefined) {
    fields.push('file_path = ?')
    values.push(input.file_path)
  }
  if (input.file_size !== undefined) {
    fields.push('file_size = ?')
    values.push(input.file_size)
  }
  if (input.error !== undefined) {
    fields.push('error = ?')
    values.push(input.error)
  }
  if (input.ended_at !== undefined) {
    fields.push('ended_at = ?')
    values.push(input.ended_at)
  }
  if (fields.length === 0) return
  values.push(id)
  database.prepare(`UPDATE live_records SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function getLiveRecords(limit = 100): DbLiveRecord[] {
  const database = getDatabase()
  return database
    .prepare('SELECT * FROM live_records ORDER BY started_at DESC LIMIT ?')
    .all(limit) as DbLiveRecord[]
}

export function getLiveRecordById(id: number): DbLiveRecord | undefined {
  const database = getDatabase()
  return database.prepare('SELECT * FROM live_records WHERE id = ?').get(id) as
    | DbLiveRecord
    | undefined
}

export function deleteLiveRecord(id: number): DbLiveRecord | undefined {
  const database = getDatabase()
  const record = database.prepare('SELECT * FROM live_records WHERE id = ?').get(id) as
    | DbLiveRecord
    | undefined
  if (!record) return undefined
  database.prepare('DELETE FROM live_records WHERE id = ?').run(id)
  return record
}

// 应用启动时清理残留的 recording 状态（进程被杀后遗留的脏数据）
export function resetStaleLiveStatus(): void {
  const database = getDatabase()
  database.exec("UPDATE users SET live_status = 'idle' WHERE live_status = 'recording'")
  database.exec(
    "UPDATE live_records SET status = 'stopped', ended_at = strftime('%s', 'now') WHERE status = 'recording'"
  )
}
