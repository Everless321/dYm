import { getDatabase } from './connection'
import type {
  AnalysisJobItemStatus,
  AnalysisJobItemView,
  AnalysisJobKind,
  AnalysisJobStatus,
  AnalysisJobView
} from '../../shared/ai'

export interface AnalysisJobRow {
  id: number
  name: string
  kind: AnalysisJobKind
  status: AnalysisJobStatus
  provider_id: string | null
  prompt: string
  options: string
  total: number
  done: number
  failed: number
  skipped: number
  priority: number
  error: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
}

export interface AnalysisJobOptions {
  slices: number
  concurrency: number
  rpm: number
  tagMode: 'open' | 'closed'
}

export function parseJobOptions(row: AnalysisJobRow): AnalysisJobOptions {
  try {
    const parsed = JSON.parse(row.options) as Partial<AnalysisJobOptions>
    return {
      slices: Math.max(1, Number(parsed.slices) || 4),
      concurrency: Math.max(1, Number(parsed.concurrency) || 2),
      rpm: Math.max(1, Number(parsed.rpm) || 10),
      tagMode: parsed.tagMode === 'closed' ? 'closed' : 'open'
    }
  } catch {
    return { slices: 4, concurrency: 2, rpm: 10, tagMode: 'open' }
  }
}

export function toJobView(
  row: AnalysisJobRow,
  extra: { providerName: string | null; current: string[] }
): AnalysisJobView {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    providerId: row.provider_id,
    providerName: extra.providerName,
    total: row.total,
    done: row.done,
    failed: row.failed,
    skipped: row.skipped,
    current: extra.current,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }
}

export function insertAnalysisJob(input: {
  name: string
  kind: AnalysisJobKind
  providerId: string | null
  prompt: string
  options: AnalysisJobOptions
  postIds: number[]
  priority: boolean
}): AnalysisJobRow {
  const database = getDatabase()
  return database.transaction(() => {
    const result = database
      .prepare(
        `INSERT INTO analysis_jobs (name, kind, status, provider_id, prompt, options, total, priority)
         VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.kind,
        input.providerId,
        input.prompt,
        JSON.stringify(input.options),
        input.postIds.length,
        input.priority ? 1 : 0
      )
    const jobId = Number(result.lastInsertRowid)
    // 经 posts 表过滤：渲染端传来的 id 可能已被删除，直接插会撞外键
    const insertItem = database.prepare(
      `INSERT OR IGNORE INTO analysis_job_items (job_id, post_id, status)
       SELECT ?, id, 'pending' FROM posts WHERE id = ?`
    )
    for (const postId of input.postIds) insertItem.run(jobId, postId)
    // 重复 / 不存在的作品被跳过后 total 要以实际条数为准
    const count = (
      database
        .prepare('SELECT COUNT(*) AS c FROM analysis_job_items WHERE job_id = ?')
        .get(jobId) as {
        c: number
      }
    ).c
    database.prepare('UPDATE analysis_jobs SET total = ? WHERE id = ?').run(count, jobId)
    return getAnalysisJob(jobId)!
  })()
}

export function getAnalysisJob(id: number): AnalysisJobRow | undefined {
  return getDatabase().prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(id) as
    | AnalysisJobRow
    | undefined
}

export function listAnalysisJobs(limit = 50): AnalysisJobRow[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM analysis_jobs
       ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
                priority DESC, id DESC
       LIMIT ?`
    )
    .all(limit) as AnalysisJobRow[]
}

/** 下一个该跑的作业：优先级高的先，其次先创建的先 */
export function nextQueuedJob(): AnalysisJobRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT * FROM analysis_jobs WHERE status = 'queued' ORDER BY priority DESC, id ASC LIMIT 1`
    )
    .get() as AnalysisJobRow | undefined
}

export function updateJobStatus(
  id: number,
  status: AnalysisJobStatus,
  patch: { error?: string | null; started?: boolean; finished?: boolean } = {}
): void {
  const sets = ['status = ?']
  const params: unknown[] = [status]
  if (patch.error !== undefined) {
    sets.push('error = ?')
    params.push(patch.error)
  }
  if (patch.started) sets.push(`started_at = COALESCE(started_at, strftime('%s','now'))`)
  if (patch.finished) sets.push(`finished_at = strftime('%s','now')`)
  params.push(id)
  getDatabase()
    .prepare(`UPDATE analysis_jobs SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params)
}

export function deleteAnalysisJob(id: number): void {
  getDatabase().prepare('DELETE FROM analysis_jobs WHERE id = ?').run(id)
}

/** 清理已结束的作业记录（保留最近 keep 条） */
export function pruneFinishedJobs(keep = 30): number {
  const result = getDatabase()
    .prepare(
      `DELETE FROM analysis_jobs WHERE status IN ('completed', 'failed', 'cancelled') AND id NOT IN (
         SELECT id FROM analysis_jobs WHERE status IN ('completed', 'failed', 'cancelled')
         ORDER BY id DESC LIMIT ?
       )`
    )
    .run(keep)
  return result.changes
}

// ==================== 条目 ====================

export interface AnalysisJobItemRow {
  job_id: number
  post_id: number
  status: AnalysisJobItemStatus
  error: string | null
  attempts: number
  finished_at: number | null
}

/** 领取一批待处理条目并标记为 running（同一作业内串行调用，无需加锁） */
export function claimPendingItems(jobId: number, limit: number): number[] {
  const database = getDatabase()
  return database.transaction(() => {
    const rows = database
      .prepare(
        `SELECT post_id FROM analysis_job_items WHERE job_id = ? AND status = 'pending' ORDER BY rowid LIMIT ?`
      )
      .all(jobId, limit) as { post_id: number }[]
    const mark = database.prepare(
      `UPDATE analysis_job_items SET status = 'running', attempts = attempts + 1 WHERE job_id = ? AND post_id = ?`
    )
    for (const row of rows) mark.run(jobId, row.post_id)
    return rows.map((r) => r.post_id)
  })()
}

export function finishItem(
  jobId: number,
  postId: number,
  status: Exclude<AnalysisJobItemStatus, 'pending' | 'running'>,
  error: string | null
): void {
  const database = getDatabase()
  database.transaction(() => {
    database
      .prepare(
        `UPDATE analysis_job_items SET status = ?, error = ?, finished_at = strftime('%s','now')
         WHERE job_id = ? AND post_id = ?`
      )
      .run(status, error, jobId, postId)
    const column = status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'skipped'
    database.prepare(`UPDATE analysis_jobs SET ${column} = ${column} + 1 WHERE id = ?`).run(jobId)
  })()
}

/** 把 running 放回 pending（暂停 / 崩溃恢复） */
export function releaseRunningItems(jobId?: number): void {
  const database = getDatabase()
  if (jobId === undefined) {
    database
      .prepare(`UPDATE analysis_job_items SET status = 'pending' WHERE status = 'running'`)
      .run()
  } else {
    database
      .prepare(
        `UPDATE analysis_job_items SET status = 'pending' WHERE job_id = ? AND status = 'running'`
      )
      .run(jobId)
  }
}

/** 失败条目重新排队，返回条数 */
export function requeueFailedItems(jobId: number): number {
  const database = getDatabase()
  return database.transaction(() => {
    const result = database
      .prepare(
        `UPDATE analysis_job_items SET status = 'pending', error = NULL, finished_at = NULL
         WHERE job_id = ? AND status = 'failed'`
      )
      .run(jobId)
    if (result.changes > 0) {
      database
        .prepare(
          `UPDATE analysis_jobs SET failed = failed - ?, error = NULL, finished_at = NULL WHERE id = ?`
        )
        .run(result.changes, jobId)
    }
    return result.changes
  })()
}

/** 重新按条目实际状态校正作业计数（恢复 / 清理后用） */
export function recountJob(jobId: number): void {
  getDatabase()
    .prepare(
      `UPDATE analysis_jobs SET
         total = (SELECT COUNT(*) FROM analysis_job_items WHERE job_id = ?),
         done = (SELECT COUNT(*) FROM analysis_job_items WHERE job_id = ? AND status = 'done'),
         failed = (SELECT COUNT(*) FROM analysis_job_items WHERE job_id = ? AND status = 'failed'),
         skipped = (SELECT COUNT(*) FROM analysis_job_items WHERE job_id = ? AND status = 'skipped')
       WHERE id = ?`
    )
    .run(jobId, jobId, jobId, jobId, jobId)
}

export function listJobItems(
  jobId: number,
  filter: { status?: AnalysisJobItemStatus; page?: number; pageSize?: number } = {}
): { items: AnalysisJobItemView[]; total: number } {
  const database = getDatabase()
  const page = Math.max(1, filter.page ?? 1)
  const pageSize = Math.max(1, Math.min(500, filter.pageSize ?? 100))
  const where = filter.status ? 'WHERE i.job_id = ? AND i.status = ?' : 'WHERE i.job_id = ?'
  const params: unknown[] = filter.status ? [jobId, filter.status] : [jobId]
  const rows = database
    .prepare(
      `SELECT i.job_id, i.post_id, i.status, i.error, i.attempts, i.finished_at,
              p.desc, p.caption, p.sec_uid, p.nickname
       FROM analysis_job_items i LEFT JOIN posts p ON p.id = i.post_id
       ${where}
       ORDER BY CASE i.status WHEN 'running' THEN 0 WHEN 'failed' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, i.rowid
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as (AnalysisJobItemRow & {
    desc: string | null
    caption: string | null
    sec_uid: string | null
    nickname: string | null
  })[]
  const total = (
    database.prepare(`SELECT COUNT(*) AS c FROM analysis_job_items i ${where}`).get(...params) as {
      c: number
    }
  ).c
  return {
    items: rows.map((r) => ({
      jobId: r.job_id,
      postId: r.post_id,
      title: postTitle(r),
      secUid: r.sec_uid ?? '',
      nickname: r.nickname ?? '',
      status: r.status,
      error: r.error,
      attempts: r.attempts,
      finishedAt: r.finished_at
    })),
    total
  }
}

export function postTitle(post: {
  desc?: string | null
  caption?: string | null
  nickname?: string | null
}): string {
  return (
    (post.desc || post.caption || '').substring(0, 30) || `${post.nickname || '未知用户'}的作品`
  )
}

/** 正在被某个未结束作业排队/处理中的作品，用于去重（自动分析不该把同一作品排两遍） */
export function activeJobPostIds(postIds: number[]): Set<number> {
  if (!postIds.length) return new Set()
  const database = getDatabase()
  const found = new Set<number>()
  // 分批避免超出 SQLite 变量上限
  for (let i = 0; i < postIds.length; i += 500) {
    const chunk = postIds.slice(i, i + 500)
    const rows = database
      .prepare(
        `SELECT DISTINCT i.post_id FROM analysis_job_items i
         JOIN analysis_jobs j ON j.id = i.job_id
         WHERE j.status IN ('queued', 'running', 'paused') AND i.status IN ('pending', 'running')
           AND i.post_id IN (${chunk.map(() => '?').join(',')})`
      )
      .all(...chunk) as { post_id: number }[]
    for (const row of rows) found.add(row.post_id)
  }
  return found
}
