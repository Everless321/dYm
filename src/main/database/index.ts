import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

const DEFAULT_ANALYSIS_PROMPT = `你是视频内容分析助手。分析视频帧截图，输出标准化JSON。

## 标签规则：
1. 标签必须原子化，先输出基础标签再输出组合标签
2. 只输出标签词本身，禁止带前缀
3. 使用中文标签
4. 标签内禁止有空格

## 常用标签参考：

【内容类型】舞蹈、唱歌、教程、Vlog、开箱、测评、美食、旅行、运动、游戏、穿搭、美妆、剧情、搞笑、知识分享

【场景】室内、室外、街拍、海边、山景、城市、乡村、咖啡厅、健身房、办公室、家居

【风格】清新、复古、简约、时尚、可爱、酷炫、文艺、治愈、搞怪

【人物】单人、双人、多人、无人

【拍摄】特写、全身、半身、航拍、延时、慢动作

## 内容等级评判（content_level 1-10）：
根据内容质量、创意程度、制作水平综合评分

## 输出字段：
- tags: 标签数组（5-15个）
- category: 主分类
- summary: 一句话描述（15字内）
- scene: 场景
- content_level: 内容等级1-10

## 输出格式（严格JSON，无其他文字）：
{"tags":["标签1","标签2"],"category":"分类","summary":"描述","scene":"场景","content_level":5}`

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'data.db')
    console.log('[Database] Path:', dbPath)
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
  }
  return db
}

export function initDatabase(): void {
  const database = getDatabase()

  // 系统设置表 - key-value 结构，便于扩展
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)

  // 用户表
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sec_uid TEXT UNIQUE NOT NULL,
      uid TEXT,
      nickname TEXT,
      signature TEXT,
      avatar TEXT,
      short_id TEXT,
      unique_id TEXT,
      following_count INTEGER DEFAULT 0,
      follower_count INTEGER DEFAULT 0,
      total_favorited INTEGER DEFAULT 0,
      aweme_count INTEGER DEFAULT 0,
      downloaded_count INTEGER DEFAULT 0,
      homepage_url TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)

  // 下载任务表
  database.exec(`
    CREATE TABLE IF NOT EXISTS download_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      concurrency INTEGER DEFAULT 3,
      total_videos INTEGER DEFAULT 0,
      downloaded_videos INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)

  // 迁移：为已存在的表添加 concurrency 列
  try {
    database.exec(`ALTER TABLE download_tasks ADD COLUMN concurrency INTEGER DEFAULT 3`)
  } catch {
    // 列已存在，忽略错误
  }

  // 迁移：为 users 表添加 show_in_home 列
  try {
    database.exec(`ALTER TABLE users ADD COLUMN show_in_home INTEGER DEFAULT 1`)
  } catch {
    // 列已存在，忽略错误
  }

  // 迁移：为 users 表添加 max_download_count 列（用户级别下载限制，0表示使用全局设置）
  try {
    database.exec(`ALTER TABLE users ADD COLUMN max_download_count INTEGER DEFAULT 0`)
  } catch {
    // 列已存在，忽略错误
  }

  // 迁移：为 users 表添加 remark 列（用户备注）
  try {
    database.exec(`ALTER TABLE users ADD COLUMN remark TEXT DEFAULT ''`)
  } catch {
    // 列已存在，忽略错误
  }

  // 迁移：为 users 表添加同步相关字段
  try {
    database.exec(`ALTER TABLE users ADD COLUMN auto_sync INTEGER DEFAULT 0`)
  } catch {
    // 列已存在
  }
  try {
    database.exec(`ALTER TABLE users ADD COLUMN sync_cron TEXT DEFAULT ''`)
  } catch {
    // 列已存在
  }
  try {
    database.exec(`ALTER TABLE users ADD COLUMN last_sync_at INTEGER`)
  } catch {
    // 列已存在
  }
  try {
    database.exec(`ALTER TABLE users ADD COLUMN sync_status TEXT DEFAULT 'idle'`)
  } catch {
    // 列已存在
  }

  // 迁移：为 download_tasks 表添加定时同步相关字段
  try {
    database.exec(`ALTER TABLE download_tasks ADD COLUMN auto_sync INTEGER DEFAULT 0`)
  } catch {
    // 列已存在
  }
  try {
    database.exec(`ALTER TABLE download_tasks ADD COLUMN sync_cron TEXT DEFAULT ''`)
  } catch {
    // 列已存在
  }
  try {
    database.exec(`ALTER TABLE download_tasks ADD COLUMN last_sync_at INTEGER`)
  } catch {
    // 列已存在
  }

  // 任务-用户关联表
  database.exec(`
    CREATE TABLE IF NOT EXISTS task_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES download_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(task_id, user_id)
    )
  `)

  // 作品表 - 存储下载的视频
  database.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aweme_id TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      sec_uid TEXT NOT NULL,
      nickname TEXT,
      caption TEXT,
      desc TEXT,
      aweme_type INTEGER DEFAULT 0,
      create_time TEXT,
      folder_name TEXT,
      cover_path TEXT,
      video_path TEXT,
      music_path TEXT,
      downloaded_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  // 迁移：为 posts 表添加分析结果字段
  const analysisColumns = [
    { name: 'analysis_tags', sql: 'ALTER TABLE posts ADD COLUMN analysis_tags TEXT' },
    { name: 'analysis_category', sql: 'ALTER TABLE posts ADD COLUMN analysis_category TEXT' },
    { name: 'analysis_summary', sql: 'ALTER TABLE posts ADD COLUMN analysis_summary TEXT' },
    { name: 'analysis_scene', sql: 'ALTER TABLE posts ADD COLUMN analysis_scene TEXT' },
    { name: 'analysis_content_level', sql: 'ALTER TABLE posts ADD COLUMN analysis_content_level INTEGER' },
    { name: 'analyzed_at', sql: 'ALTER TABLE posts ADD COLUMN analyzed_at INTEGER' }
  ]
  for (const col of analysisColumns) {
    try {
      database.exec(col.sql)
    } catch {
      // 列已存在
    }
  }

  // 初始化默认设置
  const defaultSettings = [
    { key: 'douyin_cookie', value: '' },
    { key: 'grok_api_key', value: '' },
    { key: 'grok_api_url', value: 'https://api.x.ai/v1' },
    { key: 'download_path', value: '' },
    { key: 'max_download_count', value: '50' },
    // 分析相关设置
    { key: 'analysis_concurrency', value: '2' },
    { key: 'analysis_rpm', value: '10' },
    { key: 'analysis_model', value: 'grok-4-fast' },
    { key: 'analysis_slices', value: '4' },
    { key: 'analysis_prompt', value: DEFAULT_ANALYSIS_PROMPT }
  ]

  const insertStmt = database.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `)

  for (const setting of defaultSettings) {
    insertStmt.run(setting.key, setting.value)
  }

  // 清理旧的下载任务数据（已迁移到用户同步系统）
  database.exec('DELETE FROM task_users')
  database.exec('DELETE FROM download_tasks')
}

export function getSetting(key: string): string | null {
  const database = getDatabase()
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  const database = getDatabase()
  console.log('[Database] setSetting:', key, '=', value.substring(0, 50) + (value.length > 50 ? '...' : ''))
  database
    .prepare(
      `
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = strftime('%s', 'now')
  `
    )
    .run(key, value, value)
}

export function getAllSettings(): Record<string, string> {
  const database = getDatabase()
  const rows = database.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>
  return rows.reduce(
    (acc, row) => {
      acc[row.key] = row.value
      return acc
    },
    {} as Record<string, string>
  )
}

// User CRUD
export interface DbUser {
  id: number
  sec_uid: string
  uid: string
  nickname: string
  signature: string
  avatar: string
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
  created_at: number
  updated_at: number
}

export interface CreateUserInput {
  sec_uid: string
  uid?: string
  nickname?: string
  signature?: string
  avatar?: string
  short_id?: string
  unique_id?: string
  following_count?: number
  follower_count?: number
  total_favorited?: number
  aweme_count?: number
  homepage_url?: string
}

export function createUser(input: CreateUserInput): DbUser {
  const database = getDatabase()
  const stmt = database.prepare(`
    INSERT INTO users (sec_uid, uid, nickname, signature, avatar, short_id, unique_id,
      following_count, follower_count, total_favorited, aweme_count, homepage_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    input.homepage_url || ''
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
  return database.prepare(`
    SELECT u.*, COALESCE(p.cnt, 0) as downloaded_count
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM posts GROUP BY user_id) p ON u.id = p.user_id
    ORDER BY u.created_at DESC
  `).all() as DbUser[]
}

export function updateUser(id: number, input: Partial<CreateUserInput>): DbUser | undefined {
  const database = getDatabase()
  const fields: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (fields.length === 0) return getUserById(id)

  fields.push('updated_at = strftime(\'%s\', \'now\')')
  values.push(id)

  database.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getUserById(id)
}

export function deleteUser(id: number): void {
  const database = getDatabase()
  database.prepare('DELETE FROM users WHERE id = ?').run(id)
}

export function setUserShowInHome(id: number, show: boolean): void {
  const database = getDatabase()
  database.prepare('UPDATE users SET show_in_home = ?, updated_at = strftime(\'%s\', \'now\') WHERE id = ?').run(show ? 1 : 0, id)
}

export interface UpdateUserSettingsInput {
  show_in_home?: boolean
  max_download_count?: number
  remark?: string
  auto_sync?: boolean
  sync_cron?: string
}

export function updateUserSettings(id: number, input: UpdateUserSettingsInput): DbUser | undefined {
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

  if (fields.length === 0) return getUserById(id)

  fields.push('updated_at = strftime(\'%s\', \'now\')')
  values.push(id)

  database.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getUserById(id)
}

export function updateUserSyncStatus(id: number, status: 'idle' | 'syncing' | 'error', lastSyncAt?: number): void {
  const database = getDatabase()
  if (lastSyncAt !== undefined) {
    database.prepare('UPDATE users SET sync_status = ?, last_sync_at = ?, updated_at = strftime(\'%s\', \'now\') WHERE id = ?').run(status, lastSyncAt, id)
  } else {
    database.prepare('UPDATE users SET sync_status = ?, updated_at = strftime(\'%s\', \'now\') WHERE id = ?').run(status, id)
  }
}

export function getAutoSyncUsers(): DbUser[] {
  const database = getDatabase()
  return database.prepare(`
    SELECT u.*, COALESCE(p.cnt, 0) as downloaded_count
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM posts GROUP BY user_id) p ON u.id = p.user_id
    WHERE u.auto_sync = 1
    ORDER BY u.created_at DESC
  `).all() as DbUser[]
}

export function batchUpdateUserSettings(ids: number[], input: Omit<UpdateUserSettingsInput, 'remark'>): void {
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

  if (fields.length === 0) return

  fields.push('updated_at = strftime(\'%s\', \'now\')')

  const placeholders = ids.map(() => '?').join(',')
  database.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id IN (${placeholders})`).run(...values, ...ids)
}

// Download Task CRUD
export interface DbTask {
  id: number
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  concurrency: number
  total_videos: number
  downloaded_videos: number
  auto_sync: number
  sync_cron: string
  last_sync_at: number | null
  created_at: number
  updated_at: number
}

export interface DbTaskWithUsers extends DbTask {
  users: DbUser[]
}

export interface CreateTaskInput {
  name: string
  user_ids: number[]
  concurrency?: number
  auto_sync?: boolean
  sync_cron?: string
}

export function createTask(input: CreateTaskInput): DbTaskWithUsers {
  const database = getDatabase()
  const stmt = database.prepare(`
    INSERT INTO download_tasks (name, concurrency, auto_sync, sync_cron) VALUES (?, ?, ?, ?)
  `)
  const result = stmt.run(
    input.name,
    input.concurrency ?? 3,
    input.auto_sync ? 1 : 0,
    input.sync_cron ?? ''
  )
  const taskId = result.lastInsertRowid as number

  const insertUserStmt = database.prepare(`
    INSERT INTO task_users (task_id, user_id) VALUES (?, ?)
  `)
  for (const userId of input.user_ids) {
    insertUserStmt.run(taskId, userId)
  }

  return getTaskById(taskId)!
}

export function getTaskById(id: number): DbTaskWithUsers | undefined {
  const database = getDatabase()
  const task = database.prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as DbTask | undefined
  if (!task) return undefined

  // 动态统计 downloaded_count
  const users = database.prepare(`
    SELECT u.*, COALESCE(p.cnt, 0) as downloaded_count
    FROM users u
    INNER JOIN task_users tu ON u.id = tu.user_id
    LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM posts GROUP BY user_id) p ON u.id = p.user_id
    WHERE tu.task_id = ?
  `).all(id) as DbUser[]

  return { ...task, users }
}

export function getAllTasks(): DbTaskWithUsers[] {
  const database = getDatabase()
  const tasks = database.prepare('SELECT * FROM download_tasks ORDER BY created_at DESC').all() as DbTask[]

  return tasks.map(task => {
    // 动态统计 downloaded_count
    const users = database.prepare(`
      SELECT u.*, COALESCE(p.cnt, 0) as downloaded_count
      FROM users u
      INNER JOIN task_users tu ON u.id = tu.user_id
      LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM posts GROUP BY user_id) p ON u.id = p.user_id
      WHERE tu.task_id = ?
    `).all(task.id) as DbUser[]
    return { ...task, users }
  })
}

export function updateTask(id: number, input: Partial<Omit<DbTask, 'id' | 'created_at'>>): DbTaskWithUsers | undefined {
  const database = getDatabase()
  const fields: string[] = []
  const values: unknown[] = []

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (fields.length === 0) return getTaskById(id)

  fields.push('updated_at = strftime(\'%s\', \'now\')')
  values.push(id)

  database.prepare(`UPDATE download_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getTaskById(id)
}

export function updateTaskUsers(taskId: number, userIds: number[]): DbTaskWithUsers | undefined {
  const database = getDatabase()
  database.prepare('DELETE FROM task_users WHERE task_id = ?').run(taskId)

  const insertStmt = database.prepare('INSERT INTO task_users (task_id, user_id) VALUES (?, ?)')
  for (const userId of userIds) {
    insertStmt.run(taskId, userId)
  }

  database.prepare('UPDATE download_tasks SET updated_at = strftime(\'%s\', \'now\') WHERE id = ?').run(taskId)
  return getTaskById(taskId)
}

export function deleteTask(id: number): void {
  const database = getDatabase()
  database.prepare('DELETE FROM download_tasks WHERE id = ?').run(id)
}

export function clearAllTasks(): void {
  const database = getDatabase()
  database.exec('DELETE FROM task_users')
  database.exec('DELETE FROM download_tasks')
}

export function getAutoSyncTasks(): DbTaskWithUsers[] {
  const database = getDatabase()
  const tasks = database
    .prepare("SELECT * FROM download_tasks WHERE auto_sync = 1 AND sync_cron != ''")
    .all() as DbTask[]

  return tasks.map((task) => {
    const users = database
      .prepare(
        `
      SELECT u.* FROM users u
      INNER JOIN task_users tu ON u.id = tu.user_id
      WHERE tu.task_id = ?
    `
      )
      .all(task.id) as DbUser[]
    return { ...task, users }
  })
}

export function updateTaskLastSyncAt(id: number): void {
  const database = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  database
    .prepare('UPDATE download_tasks SET last_sync_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id)
}

// Post CRUD
export interface DbPost {
  id: number
  aweme_id: string
  user_id: number
  sec_uid: string
  nickname: string
  caption: string
  desc: string
  aweme_type: number
  create_time: string
  folder_name: string
  cover_path: string | null
  video_path: string | null
  music_path: string | null
  downloaded_at: number
  // 分析结果
  analysis_tags: string | null
  analysis_category: string | null
  analysis_summary: string | null
  analysis_scene: string | null
  analysis_content_level: number | null
  analyzed_at: number | null
}

export interface CreatePostInput {
  aweme_id: string
  user_id: number
  sec_uid: string
  nickname?: string
  caption?: string
  desc?: string
  aweme_type?: number
  create_time?: string
  folder_name: string
  cover_path?: string
  video_path?: string
  music_path?: string
}

export function createPost(input: CreatePostInput): DbPost {
  const database = getDatabase()
  const stmt = database.prepare(`
    INSERT INTO posts (aweme_id, user_id, sec_uid, nickname, caption, desc, aweme_type, create_time, folder_name, cover_path, video_path, music_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    input.aweme_id,
    input.user_id,
    input.sec_uid,
    input.nickname || '',
    input.caption || '',
    input.desc || '',
    input.aweme_type || 0,
    input.create_time || '',
    input.folder_name,
    input.cover_path || null,
    input.video_path || null,
    input.music_path || null
  )
  return getPostById(result.lastInsertRowid as number)!
}

export function getPostById(id: number): DbPost | undefined {
  const database = getDatabase()
  return database.prepare('SELECT * FROM posts WHERE id = ?').get(id) as DbPost | undefined
}

export function getPostByAwemeId(awemeId: string): DbPost | undefined {
  const database = getDatabase()
  return database.prepare('SELECT * FROM posts WHERE aweme_id = ?').get(awemeId) as DbPost | undefined
}

export function getPostsByUserId(userId: number): DbPost[] {
  const database = getDatabase()
  return database.prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY downloaded_at DESC').all(userId) as DbPost[]
}

export function getPostCountByUserId(userId: number): number {
  const database = getDatabase()
  const row = database.prepare('SELECT COUNT(*) as count FROM posts WHERE user_id = ?').get(userId) as { count: number }
  return row.count
}

export interface PostAuthor {
  sec_uid: string
  nickname: string
}

export interface PostFilters {
  secUid?: string
  tags?: string[]
  minContentLevel?: number
  maxContentLevel?: number
  analyzedOnly?: boolean
}

export function getAllPosts(
  page: number = 1,
  pageSize: number = 20,
  filters?: PostFilters
): { posts: DbPost[]; total: number; authors: PostAuthor[] } {
  const database = getDatabase()
  const offset = (page - 1) * pageSize

  // 获取可见用户的 sec_uid 列表
  const visibleUsers = database
    .prepare('SELECT sec_uid FROM users WHERE show_in_home = 1')
    .all() as { sec_uid: string }[]
  const visibleSecUids = visibleUsers.map((u) => u.sec_uid)

  if (visibleSecUids.length === 0) {
    return { posts: [], total: 0, authors: [] }
  }

  // 获取可见作者列表
  const placeholders = visibleSecUids.map(() => '?').join(',')
  const authorsRows = database
    .prepare(`SELECT DISTINCT sec_uid, nickname FROM posts WHERE sec_uid IN (${placeholders}) ORDER BY nickname`)
    .all(...visibleSecUids) as PostAuthor[]
  const authors = authorsRows.filter((r) => r.sec_uid && r.nickname)

  // 构建查询
  const conditions: string[] = [`sec_uid IN (${placeholders})`]
  const params: unknown[] = [...visibleSecUids]

  if (filters?.secUid) {
    conditions.push('sec_uid = ?')
    params.push(filters.secUid)
  }

  if (filters?.tags && filters.tags.length > 0) {
    const tagConditions = filters.tags.map(() => 'analysis_tags LIKE ?').join(' OR ')
    conditions.push(`(${tagConditions})`)
    filters.tags.forEach((tag) => params.push(`%"${tag}"%`))
  }

  if (filters?.minContentLevel !== undefined) {
    conditions.push('analysis_content_level >= ?')
    params.push(filters.minContentLevel)
  }

  if (filters?.maxContentLevel !== undefined) {
    conditions.push('analysis_content_level <= ?')
    params.push(filters.maxContentLevel)
  }

  if (filters?.analyzedOnly) {
    conditions.push('analyzed_at IS NOT NULL')
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`

  const posts = database
    .prepare(`SELECT * FROM posts ${whereClause} ORDER BY create_time DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as DbPost[]

  const countRow = database
    .prepare(`SELECT COUNT(*) as count FROM posts ${whereClause}`)
    .get(...params) as { count: number }

  return { posts, total: countRow.count, authors }
}

export function getAllTags(): string[] {
  const database = getDatabase()

  // 获取可见用户的帖子中的所有标签
  const visibleUsers = database
    .prepare('SELECT sec_uid FROM users WHERE show_in_home = 1')
    .all() as { sec_uid: string }[]
  const visibleSecUids = visibleUsers.map((u) => u.sec_uid)

  if (visibleSecUids.length === 0) {
    return []
  }

  const placeholders = visibleSecUids.map(() => '?').join(',')
  const rows = database
    .prepare(`SELECT analysis_tags FROM posts WHERE sec_uid IN (${placeholders}) AND analysis_tags IS NOT NULL`)
    .all(...visibleSecUids) as { analysis_tags: string }[]

  const tagSet = new Set<string>()
  for (const row of rows) {
    try {
      const tags = JSON.parse(row.analysis_tags)
      if (Array.isArray(tags)) {
        tags.forEach((tag) => tagSet.add(tag))
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  return Array.from(tagSet).sort()
}

// 分析相关函数
export interface AnalysisResult {
  tags: string[]
  category: string
  summary: string
  scene: string
  content_level: number
}

export function getUnanalyzedPostsCount(secUid?: string): number {
  const database = getDatabase()
  if (secUid) {
    const row = database.prepare(
      'SELECT COUNT(*) as count FROM posts WHERE sec_uid = ? AND analyzed_at IS NULL'
    ).get(secUid) as { count: number }
    return row.count
  }
  const row = database.prepare(
    'SELECT COUNT(*) as count FROM posts WHERE analyzed_at IS NULL'
  ).get() as { count: number }
  return row.count
}

export function getUnanalyzedPostsCountByUser(): { sec_uid: string; nickname: string; count: number }[] {
  const database = getDatabase()
  return database.prepare(`
    SELECT sec_uid, nickname, COUNT(*) as count
    FROM posts
    WHERE analyzed_at IS NULL
    GROUP BY sec_uid
    ORDER BY count DESC
  `).all() as { sec_uid: string; nickname: string; count: number }[]
}

export interface UserAnalysisStats {
  sec_uid: string
  nickname: string
  total: number
  analyzed: number
  unanalyzed: number
}

export function getUserAnalysisStats(): UserAnalysisStats[] {
  const database = getDatabase()

  // 获取所有用户（分析页面不受 show_in_home 限制）
  const allUsers = database
    .prepare('SELECT sec_uid, nickname FROM users ORDER BY nickname')
    .all() as { sec_uid: string; nickname: string }[]

  if (allUsers.length === 0) return []

  const result: UserAnalysisStats[] = []

  for (const user of allUsers) {
    const stats = database
      .prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN analyzed_at IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
          SUM(CASE WHEN analyzed_at IS NULL THEN 1 ELSE 0 END) as unanalyzed
        FROM posts
        WHERE sec_uid = ?
      `)
      .get(user.sec_uid) as { total: number; analyzed: number; unanalyzed: number } | undefined

    result.push({
      sec_uid: user.sec_uid,
      nickname: user.nickname,
      total: stats?.total || 0,
      analyzed: stats?.analyzed || 0,
      unanalyzed: stats?.unanalyzed || 0
    })
  }

  return result
}

export function getTotalAnalysisStats(): { total: number; analyzed: number; unanalyzed: number } {
  const database = getDatabase()

  // 获取所有帖子的分析统计（分析页面不受 show_in_home 限制）
  const stats = database
    .prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN analyzed_at IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
        SUM(CASE WHEN analyzed_at IS NULL THEN 1 ELSE 0 END) as unanalyzed
      FROM posts
    `)
    .get() as { total: number; analyzed: number; unanalyzed: number }

  return stats || { total: 0, analyzed: 0, unanalyzed: 0 }
}

export function getUnanalyzedPosts(secUid?: string, limit?: number): DbPost[] {
  const database = getDatabase()
  let sql = 'SELECT * FROM posts WHERE analyzed_at IS NULL'
  const params: unknown[] = []

  if (secUid) {
    sql += ' AND sec_uid = ?'
    params.push(secUid)
  }

  sql += ' ORDER BY downloaded_at DESC'

  if (limit) {
    sql += ' LIMIT ?'
    params.push(limit)
  }

  return database.prepare(sql).all(...params) as DbPost[]
}

export function updatePostAnalysis(id: number, result: AnalysisResult): void {
  const database = getDatabase()
  database.prepare(`
    UPDATE posts SET
      analysis_tags = ?,
      analysis_category = ?,
      analysis_summary = ?,
      analysis_scene = ?,
      analysis_content_level = ?,
      analyzed_at = strftime('%s', 'now')
    WHERE id = ?
  `).run(
    JSON.stringify(result.tags),
    result.category,
    result.summary,
    result.scene,
    result.content_level,
    id
  )
}

// 标准化路径前缀（确保尾部有 /）
function normalizeDirPrefix(p: string): string {
  return p.endsWith('/') ? p : p + '/'
}

// 获取需要迁移的帖子数量
export function getMigrationCount(oldBasePath: string): number {
  const prefix = normalizeDirPrefix(oldBasePath)
  const database = getDatabase()
  const row = database
    .prepare(`SELECT COUNT(*) as cnt FROM posts WHERE video_path LIKE ?`)
    .get(`${prefix}%`) as { cnt: number }
  return row.cnt
}

// 批量替换路径前缀
export function batchReplacePaths(oldBasePath: string, newBasePath: string): number {
  const oldPrefix = normalizeDirPrefix(oldBasePath)
  const newPrefix = normalizeDirPrefix(newBasePath)
  const database = getDatabase()
  const len = oldPrefix.length + 1
  const like = `${oldPrefix}%`
  const result = database
    .prepare(
      `UPDATE posts SET
        video_path = CASE WHEN video_path LIKE ? THEN ? || substr(video_path, ?) ELSE video_path END,
        cover_path = CASE WHEN cover_path LIKE ? THEN ? || substr(cover_path, ?) ELSE cover_path END,
        music_path = CASE WHEN music_path LIKE ? THEN ? || substr(music_path, ?) ELSE music_path END
      WHERE video_path LIKE ? OR cover_path LIKE ? OR music_path LIKE ?`
    )
    .run(
      like, newPrefix, len,
      like, newPrefix, len,
      like, newPrefix, len,
      like, like, like
    )
  return result.changes
}

// 获取需要迁移的不重复作者目录
export function getMigrationSecUids(oldBasePath: string): string[] {
  const prefix = normalizeDirPrefix(oldBasePath)
  const database = getDatabase()
  const rows = database
    .prepare(`SELECT DISTINCT video_path FROM posts WHERE video_path LIKE ?`)
    .all(`${prefix}%`) as { video_path: string }[]

  const secUids = new Set<string>()
  for (const row of rows) {
    const relative = row.video_path.slice(prefix.length)
    const slashIdx = relative.indexOf('/')
    if (slashIdx > 0) {
      secUids.add(relative.slice(0, slashIdx))
    }
  }
  return [...secUids]
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
