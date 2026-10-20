import { getDatabase } from './connection'
import { appEvents } from '../services/app-events'
import {
  normalizeBilibiliCreatorSettings,
  normalizeCreatorPlatform,
  type BilibiliCreatorSettings
} from '../../shared/platforms'

// User CRUD
export interface DbUser {
  id: number
  sec_uid: string
  uid: string
  nickname: string
  signature: string
  avatar: string
  avatar_path: string
  short_id: string
  unique_id: string
  following_count: number
  follower_count: number
  total_favorited: number
  aweme_count: number
  downloaded_count: number
  homepage_url: string
  show_in_home: number
  max_download_count: number
  remark: string
  // 同步相关字段
  auto_sync: number
  sync_cron: string
  last_sync_at: number | null
  sync_status: 'idle' | 'syncing' | 'error'
  // 直播录制相关字段
  live_record: number
  live_check_cron: string
  live_status: 'idle' | 'recording'
  last_live_at: number | null
  /** douyin | bilibili，旧数据缺省为抖音 */
  platform: string
  /** 平台专属设置的 JSON。抖音的直播计划仍写在 live_* 列 */
  platform_settings: string
  created_at: number
  updated_at: number
}

export interface CreateUserInput {
  sec_uid: string
  uid?: string
  nickname?: string
  signature?: string
  avatar?: string
  avatar_path?: string
  short_id?: string
  unique_id?: string
  following_count?: number
  follower_count?: number
  total_favorited?: number
  aweme_count?: number
  homepage_url?: string
  platform?: string
  platform_settings?: string
}

export function createUser(input: CreateUserInput): DbUser {
  const database = getDatabase()
  const stmt = database.prepare(`
    INSERT INTO users (sec_uid, uid, nickname, signature, avatar, short_id, unique_id,
      following_count, follower_count, total_favorited, aweme_count, homepage_url, platform, platform_settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    input.sec_uid,
    input.uid || '',
    input.nickname || '',
    input.signature || '',
    input.avatar || '',
    input.short_id || '',
    input.unique_id || '',
    input.following_count || 0,
    input.follower_count || 0,
    input.total_favorited || 0,
    input.aweme_count || 0,
    input.homepage_url || '',
    normalizeCreatorPlatform(input.platform),
    input.platform_settings || '{}'
  )
  return getUserById(result.lastInsertRowid as number)!
}

export function getUserById(id: number): DbUser | undefined {
  const database = getDatabase()
  return database.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined
}

export function getUserBySecUid(secUid: string): DbUser | undefined {
  const database = getDatabase()
  return database.prepare('SELECT * FROM users WHERE sec_uid = ?').get(secUid) as DbUser | undefined
}

export function getAllUsers(): DbUser[] {
  const database = getDatabase()
  // 动态统计 downloaded_count
  return database
    .prepare(
      `
    SELECT u.*, COALESCE(p.cnt, 0) as downloaded_count
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM posts GROUP BY user_id) p ON u.id = p.user_id
    ORDER BY u.created_at DESC
  `
    )
    .all() as DbUser[]
}

/** updateUser 允许写入的列。列名会拼进 SQL，必须走白名单而不是信任入参的 key */
const USER_UPDATABLE_COLUMNS: ReadonlySet<keyof CreateUserInput> = new Set([
  'sec_uid',
  'uid',
  'nickname',
  'signature',
  'avatar',
  'avatar_path',
  'short_id',
  'unique_id',
  'following_count',
  'follower_count',
  'total_favorited',
  'aweme_count',
  'homepage_url'
])

export function updateUser(id: number, input: Partial<CreateUserInput>): DbUser | undefined {
  const database = getDatabase()
  const fields: string[] = []
  const values: unknown[] = []

  for (const key of USER_UPDATABLE_COLUMNS) {
    const value = input[key]
    if (value !== undefined) {
      fields.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (fields.length === 0) return getUserById(id)

  fields.push("updated_at = strftime('%s', 'now')")
  values.push(id)

  database.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getUserById(id)
}

export function deleteUser(id: number): { sec_uid: string } | undefined {
  const database = getDatabase()
  const user = getUserById(id)
  if (!user) return undefined
  // 三张表一起删，中途失败整体回滚，避免留下没有归属的作品/任务关联
  database.transaction(() => {
    database.prepare('DELETE FROM posts WHERE user_id = ?').run(id)
    database.prepare('DELETE FROM task_users WHERE user_id = ?').run(id)
    database.prepare('DELETE FROM users WHERE id = ?').run(id)
  })()
  appEvents.emitDataChange('user:deleted', id)
  return { sec_uid: user.sec_uid }
}

export function setUserShowInHome(id: number, show: boolean): void {
  const database = getDatabase()
  database
    .prepare("UPDATE users SET show_in_home = ?, updated_at = strftime('%s', 'now') WHERE id = ?")
    .run(show ? 1 : 0, id)
}

export interface UpdateUserSettingsInput {
  show_in_home?: boolean
  max_download_count?: number
  remark?: string
  auto_sync?: boolean
  sync_cron?: string
  live_record?: boolean
  live_check_cron?: string
  platform_settings?: BilibiliCreatorSettings
}

export function updateUserSettings(id: number, input: UpdateUserSettingsInput): DbUser | undefined {
  const database = getDatabase()
  const current = getUserById(id)
  if (!current) return undefined
  const platform = normalizeCreatorPlatform(current.platform)
  const fields: string[] = []
  const values: unknown[] = []

  if (input.show_in_home !== undefined) {
    fields.push('show_in_home = ?')
    values.push(input.show_in_home ? 1 : 0)
  }
  if (input.max_download_count !== undefined) {
    fields.push('max_download_count = ?')
    values.push(input.max_download_count)
  }
  if (input.remark !== undefined) {
    fields.push('remark = ?')
    values.push(input.remark)
  }
  if (input.auto_sync !== undefined) {
    fields.push('auto_sync = ?')
    values.push(input.auto_sync ? 1 : 0)
  }
  if (input.sync_cron !== undefined) {
    fields.push('sync_cron = ?')
    values.push(input.sync_cron)
  }
  if (platform === 'douyin' && input.live_record !== undefined) {
    fields.push('live_record = ?')
    values.push(input.live_record ? 1 : 0)
  }
  if (platform === 'douyin' && input.live_check_cron !== undefined) {
    fields.push('live_check_cron = ?')
    values.push(input.live_check_cron)
  }
  if (platform === 'bilibili' && input.platform_settings !== undefined) {
    fields.push('platform_settings = ?')
    values.push(JSON.stringify(normalizeBilibiliCreatorSettings(input.platform_settings)))
  }

  if (fields.length === 0) return getUserById(id)

  fields.push("updated_at = strftime('%s', 'now')")
  values.push(id)

  database.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  appEvents.emitDataChange('user:settings-changed', id)
  return getUserById(id)
}

export function updateUserSyncStatus(
  id: number,
  status: 'idle' | 'syncing' | 'error',
  lastSyncAt?: number
): void {
  const database = getDatabase()
  if (lastSyncAt !== undefined) {
    database
      .prepare(
        "UPDATE users SET sync_status = ?, last_sync_at = ?, updated_at = strftime('%s', 'now') WHERE id = ?"
      )
      .run(status, lastSyncAt, id)
  } else {
    database
      .prepare("UPDATE users SET sync_status = ?, updated_at = strftime('%s', 'now') WHERE id = ?")
      .run(status, id)
  }
}

/**
 * 应用启动时清理上次进程被杀留下的 'syncing'。同步状态只存在于内存里的 runningSyncs，
 * 进程没了它就不可能还在同步，库里却会一直显示「同步中」。
 */
export function resetStaleSyncStatus(): void {
  getDatabase().exec("UPDATE users SET sync_status = 'idle' WHERE sync_status = 'syncing'")
}

export function getAutoSyncUsers(): DbUser[] {
  const database = getDatabase()
  return database
    .prepare(
      `
    SELECT u.*, COALESCE(p.cnt, 0) as downloaded_count
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM posts GROUP BY user_id) p ON u.id = p.user_id
    WHERE u.auto_sync = 1
    ORDER BY u.created_at DESC
  `
    )
    .all() as DbUser[]
}

export function batchUpdateUserSettings(
  ids: number[],
  input: Omit<UpdateUserSettingsInput, 'remark'>
): void {
  const database = getDatabase()
  const fields: string[] = []
  const values: unknown[] = []

  if (input.show_in_home !== undefined) {
    fields.push('show_in_home = ?')
    values.push(input.show_in_home ? 1 : 0)
  }
  if (input.max_download_count !== undefined) {
    fields.push('max_download_count = ?')
    values.push(input.max_download_count)
  }
  if (input.auto_sync !== undefined) {
    fields.push('auto_sync = ?')
    values.push(input.auto_sync ? 1 : 0)
  }
  if (input.sync_cron !== undefined) {
    fields.push('sync_cron = ?')
    values.push(input.sync_cron)
  }
  const liveFields: string[] = []
  const liveValues: unknown[] = []
  if (input.live_record !== undefined) {
    liveFields.push('live_record = ?')
    liveValues.push(input.live_record ? 1 : 0)
  }
  if (input.live_check_cron !== undefined) {
    liveFields.push('live_check_cron = ?')
    liveValues.push(input.live_check_cron)
  }

  if (fields.length === 0 && liveFields.length === 0) return

  const placeholders = ids.map(() => '?').join(',')
  if (fields.length > 0) {
    const shared = [...fields, "updated_at = strftime('%s', 'now')"]
    database
      .prepare(`UPDATE users SET ${shared.join(', ')} WHERE id IN (${placeholders})`)
      .run(...values, ...ids)
  }
  if (liveFields.length > 0) {
    const live = [...liveFields, "updated_at = strftime('%s', 'now')"]
    database
      .prepare(
        `UPDATE users SET ${live.join(', ')} WHERE platform = 'douyin' AND id IN (${placeholders})`
      )
      .run(...liveValues, ...ids)
  }
  for (const id of ids) {
    appEvents.emitDataChange('user:settings-changed', id)
  }
}

// ==================== 直播录制 ====================

export function getLiveRecordUsers(): DbUser[] {
  const database = getDatabase()
  return database
    .prepare(
      `
    SELECT u.*, COALESCE(p.cnt, 0) as downloaded_count
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM posts GROUP BY user_id) p ON u.id = p.user_id
    WHERE u.live_record = 1 AND u.platform = 'douyin'
    ORDER BY u.created_at DESC
  `
    )
    .all() as DbUser[]
}

export function updateUserLiveStatus(
  id: number,
  status: 'idle' | 'recording',
  lastLiveAt?: number
): void {
  const database = getDatabase()
  if (lastLiveAt !== undefined) {
    database
      .prepare(
        "UPDATE users SET live_status = ?, last_live_at = ?, updated_at = strftime('%s', 'now') WHERE id = ?"
      )
      .run(status, lastLiveAt, id)
  } else {
    database
      .prepare("UPDATE users SET live_status = ?, updated_at = strftime('%s', 'now') WHERE id = ?")
      .run(status, id)
  }
}
