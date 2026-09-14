import { getDatabase } from './connection'
import type { DbUser } from './users'

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
  const insertTask = database.prepare(
    'INSERT INTO download_tasks (name, concurrency, auto_sync, sync_cron) VALUES (?, ?, ?, ?)'
  )
  const insertUser = database.prepare('INSERT INTO task_users (task_id, user_id) VALUES (?, ?)')

  // 任务行与关联行必须同时落库，否则中途失败会留下一个没有用户的任务
  const taskId = database.transaction((): number => {
    const result = insertTask.run(
      input.name,
      input.concurrency ?? 3,
      input.auto_sync ? 1 : 0,
      input.sync_cron ?? ''
    )
    const id = result.lastInsertRowid as number
    for (const userId of input.user_ids) {
      insertUser.run(id, userId)
    }
    return id
  })()

  return getTaskById(taskId)!
}

/**
 * 一次查出多条任务的关联用户（附动态统计的 downloaded_count），按 task_id 分组。
 * 代替「每个任务再查一次用户」的 N+1 写法。
 */
function loadTaskUsers(taskIds: number[]): Map<number, DbUser[]> {
  const grouped = new Map<number, DbUser[]>()
  if (taskIds.length === 0) return grouped
  const database = getDatabase()
  const placeholders = taskIds.map(() => '?').join(',')
  const rows = database
    .prepare(
      `SELECT tu.task_id, u.*, COALESCE(p.cnt, 0) as downloaded_count
       FROM task_users tu
       INNER JOIN users u ON u.id = tu.user_id
       LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM posts GROUP BY user_id) p ON u.id = p.user_id
       WHERE tu.task_id IN (${placeholders})
       ORDER BY tu.id`
    )
    .all(...taskIds) as (DbUser & { task_id: number })[]
  for (const { task_id, ...user } of rows) {
    const list = grouped.get(task_id) ?? []
    list.push(user as DbUser)
    grouped.set(task_id, list)
  }
  return grouped
}

function attachTaskUsers(tasks: DbTask[]): DbTaskWithUsers[] {
  const usersByTask = loadTaskUsers(tasks.map((t) => t.id))
  return tasks.map((task) => ({ ...task, users: usersByTask.get(task.id) ?? [] }))
}

export function getTaskById(id: number): DbTaskWithUsers | undefined {
  const database = getDatabase()
  const task = database.prepare('SELECT * FROM download_tasks WHERE id = ?').get(id) as
    | DbTask
    | undefined
  if (!task) return undefined
  return attachTaskUsers([task])[0]
}

export function getAllTasks(): DbTaskWithUsers[] {
  const database = getDatabase()
  const tasks = database
    .prepare('SELECT * FROM download_tasks ORDER BY created_at DESC')
    .all() as DbTask[]
  return attachTaskUsers(tasks)
}

export type UpdateTaskInput = Partial<Omit<DbTask, 'id' | 'created_at' | 'updated_at'>>

/** updateTask 允许写入的列。列名会拼进 SQL，必须走白名单而不是信任入参的 key */
const TASK_UPDATABLE_COLUMNS: ReadonlySet<keyof UpdateTaskInput> = new Set([
  'name',
  'status',
  'concurrency',
  'total_videos',
  'downloaded_videos',
  'auto_sync',
  'sync_cron',
  'last_sync_at'
])

export function updateTask(id: number, input: UpdateTaskInput): DbTaskWithUsers | undefined {
  const database = getDatabase()
  const fields: string[] = []
  const values: unknown[] = []

  for (const key of TASK_UPDATABLE_COLUMNS) {
    const value = input[key]
    if (value !== undefined) {
      fields.push(`${key} = ?`)
      values.push(value)
    }
  }

  if (fields.length === 0) return getTaskById(id)

  fields.push("updated_at = strftime('%s', 'now')")
  values.push(id)

  database.prepare(`UPDATE download_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getTaskById(id)
}

export function updateTaskUsers(taskId: number, userIds: number[]): DbTaskWithUsers | undefined {
  const database = getDatabase()
  const clear = database.prepare('DELETE FROM task_users WHERE task_id = ?')
  const insert = database.prepare('INSERT INTO task_users (task_id, user_id) VALUES (?, ?)')
  const touch = database.prepare(
    "UPDATE download_tasks SET updated_at = strftime('%s', 'now') WHERE id = ?"
  )

  // 先清后插要原子，否则插入中途失败会把任务的用户列表清空
  database.transaction(() => {
    clear.run(taskId)
    for (const userId of userIds) {
      insert.run(taskId, userId)
    }
    touch.run(taskId)
  })()
  return getTaskById(taskId)
}

export function deleteTask(id: number): void {
  const database = getDatabase()
  database.transaction(() => {
    database.prepare('DELETE FROM task_users WHERE task_id = ?').run(id)
    database.prepare('DELETE FROM download_tasks WHERE id = ?').run(id)
  })()
}

export function clearAllTasks(): void {
  const database = getDatabase()
  database.transaction(() => {
    database.exec('DELETE FROM task_users')
    database.exec('DELETE FROM download_tasks')
  })()
}

export function getAutoSyncTasks(): DbTaskWithUsers[] {
  const database = getDatabase()
  const tasks = database
    .prepare("SELECT * FROM download_tasks WHERE auto_sync = 1 AND sync_cron != ''")
    .all() as DbTask[]
  return attachTaskUsers(tasks)
}

export function updateTaskLastSyncAt(id: number): void {
  const database = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  database
    .prepare('UPDATE download_tasks SET last_sync_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id)
}
