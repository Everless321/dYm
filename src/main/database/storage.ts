import type Database from 'better-sqlite3'
import { getDatabase } from './connection'
import type { ObjectKind } from '../services/storage/keys'
import type { StorageQueueStats } from '../../shared/storage'

/**
 * 对象存储相关的表：
 * - post_objects：作品在桶里有哪些对象（key / 大小），读取时本地缺文件就按它生成远程地址
 * - storage_queue：待上传作品队列，一条作品一行，重启后接着传
 * - posts.storage_state：null 未上云 / synced 已上云（本地也还在）/ cloud_only 本地只剩封面或整个目录都不在
 * - posts.storage_synced_at：上云时间，按保留期清理本地时用
 */
export function initStorageSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS post_objects (
      key TEXT PRIMARY KEY,
      aweme_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      idx INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL,
      content_type TEXT,
      uploaded_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_post_objects_aweme ON post_objects(aweme_id)`)
  database.exec(`
    CREATE TABLE IF NOT EXISTS storage_queue (
      aweme_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_storage_queue_status ON storage_queue(status)`)
  // 作品记录被删（删作者会级联）后留下的对象记录，启动时清一次
  database.exec(`DELETE FROM post_objects WHERE aweme_id NOT IN (SELECT aweme_id FROM posts)`)
}

export type StorageState = 'synced' | 'cloud_only'

export interface StoredPost {
  aweme_id: string
  sec_uid: string
  folder_name: string | null
  downloaded_at?: number | null
}

export interface PostObjectRow {
  key: string
  aweme_id: string
  kind: ObjectKind
  idx: number
  size: number
  content_type: string | null
}

export interface QueuedPost {
  aweme_id: string
  sec_uid: string
  folder_name: string | null
}

export function getPostObjects(awemeId: string): PostObjectRow[] {
  return getDatabase()
    .prepare(
      `SELECT key, aweme_id, kind, idx, size, content_type FROM post_objects
       WHERE aweme_id = ? ORDER BY kind, idx`
    )
    .all(awemeId) as PostObjectRow[]
}

/** 一条作品的对象整体替换，并把作品标成已上云，在同一个事务里完成 */
export function recordPostSynced(
  awemeId: string,
  objects: Omit<PostObjectRow, 'aweme_id'>[],
  state: StorageState = 'synced'
): void {
  const db = getDatabase()
  const insert = db.prepare(
    `INSERT INTO post_objects (key, aweme_id, kind, idx, size, content_type)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  db.transaction(() => {
    db.prepare('DELETE FROM post_objects WHERE aweme_id = ?').run(awemeId)
    for (const o of objects) {
      insert.run(o.key, awemeId, o.kind, o.idx, o.size, o.content_type)
    }
    db.prepare(
      `UPDATE posts SET storage_state = ?, storage_synced_at = strftime('%s','now') WHERE aweme_id = ?`
    ).run(state, awemeId)
    db.prepare(
      `UPDATE storage_queue SET status = 'done', error = NULL, updated_at = strftime('%s','now')
       WHERE aweme_id = ?`
    ).run(awemeId)
  })()
}

/** 排队；已完成的不会被重新排，失败的会被重置回 queued */
export function enqueuePosts(awemeIds: readonly string[]): number {
  const db = getDatabase()
  const stmt = db.prepare(
    `INSERT INTO storage_queue (aweme_id) VALUES (?)
     ON CONFLICT(aweme_id) DO UPDATE SET status = 'queued', attempts = 0, error = NULL,
       updated_at = strftime('%s','now')
     WHERE storage_queue.status = 'failed'`
  )
  let changed = 0
  db.transaction(() => {
    for (const id of awemeIds) changed += stmt.run(id).changes
  })()
  return changed
}

/** 把所有还没上云的作品排进队列（上传现有作品）；已上云和本地已清理的不动 */
export function enqueueUnsyncedPosts(): number {
  return getDatabase()
    .prepare(
      `INSERT INTO storage_queue (aweme_id)
       SELECT aweme_id FROM posts WHERE storage_state IS NULL
       ON CONFLICT(aweme_id) DO UPDATE SET status = 'queued', attempts = 0, error = NULL,
         updated_at = strftime('%s','now')
       WHERE storage_queue.status IN ('failed', 'done')`
    )
    .run().changes
}

export function retryFailedUploads(): number {
  return getDatabase()
    .prepare(
      `UPDATE storage_queue SET status = 'queued', attempts = 0, error = NULL,
         updated_at = strftime('%s','now')
       WHERE status = 'failed'`
    )
    .run().changes
}

/** 上次退出时正在传的，重启后回到队列 */
export function requeueInterruptedUploads(): number {
  return getDatabase()
    .prepare(`UPDATE storage_queue SET status = 'queued' WHERE status = 'running'`)
    .run().changes
}

/** 领取下一条：原子地把 queued 改成 running；作品已被删的顺手标 done 跳过 */
export function claimNextUpload(): QueuedPost | null {
  const db = getDatabase()
  return db.transaction((): QueuedPost | null => {
    for (;;) {
      const row = db
        .prepare(
          `SELECT q.aweme_id, p.sec_uid, p.folder_name FROM storage_queue q
           LEFT JOIN posts p ON p.aweme_id = q.aweme_id
           WHERE q.status = 'queued' ORDER BY q.updated_at, q.rowid LIMIT 1`
        )
        .get() as (Omit<QueuedPost, 'sec_uid'> & { sec_uid: string | null }) | undefined
      if (!row) return null
      if (!row.sec_uid) {
        db.prepare(`DELETE FROM storage_queue WHERE aweme_id = ?`).run(row.aweme_id)
        continue
      }
      db.prepare(
        `UPDATE storage_queue SET status = 'running', attempts = attempts + 1,
           updated_at = strftime('%s','now')
         WHERE aweme_id = ?`
      ).run(row.aweme_id)
      return { aweme_id: row.aweme_id, sec_uid: row.sec_uid, folder_name: row.folder_name }
    }
  })()
}

export function markUploadFailed(awemeId: string, error: string): void {
  getDatabase()
    .prepare(
      `UPDATE storage_queue SET status = 'failed', error = ?, updated_at = strftime('%s','now')
       WHERE aweme_id = ?`
    )
    .run(error.slice(0, 500), awemeId)
}

export function markPostCloudOnly(awemeId: string): void {
  getDatabase()
    .prepare(`UPDATE posts SET storage_state = 'cloud_only' WHERE aweme_id = ?`)
    .run(awemeId)
}

/** 已上云、本地还在、上云超过 cutoff 的作品（按保留期自动清理本地用） */
export function listPruneCandidates(cutoff: number, limit: number): StoredPost[] {
  return getDatabase()
    .prepare(
      `SELECT aweme_id, sec_uid, folder_name FROM posts
       WHERE storage_state = 'synced' AND storage_synced_at <= ?
       ORDER BY storage_synced_at LIMIT ?`
    )
    .all(cutoff, limit) as StoredPost[]
}

/** 已上云、本地还在的作品，按下载时间从早到晚（迁移向导里按比例清理用） */
export function listSyncedPostsOldestFirst(): StoredPost[] {
  return getDatabase()
    .prepare(
      `SELECT aweme_id, sec_uid, folder_name, downloaded_at FROM posts
       WHERE storage_state = 'synced' ORDER BY downloaded_at, id`
    )
    .all() as StoredPost[]
}

export function getAllPostObjectSizes(): { key: string; aweme_id: string; size: number }[] {
  return getDatabase().prepare('SELECT key, aweme_id, size FROM post_objects').all() as {
    key: string
    aweme_id: string
    size: number
  }[]
}

/** 有云端副本的作品 id（体检时本地缺文件的这些不算损坏） */
export function getAwemeIdsWithCloudCopy(): Set<string> {
  const rows = getDatabase().prepare('SELECT DISTINCT aweme_id FROM post_objects').all() as {
    aweme_id: string
  }[]
  return new Set(rows.map((r) => r.aweme_id))
}

/**
 * 核对发现桶里对不上：清掉记录重新排队。本地还在的会重传；
 * 本地已经清理掉的只能从桶里认领剩下的部分（上传会失败并在列表里提示）。
 */
export function resetPostSync(awemeIds: readonly string[]): void {
  const db = getDatabase()
  db.transaction(() => {
    for (const id of awemeIds) {
      db.prepare('DELETE FROM post_objects WHERE aweme_id = ?').run(id)
      db.prepare(
        `UPDATE posts SET storage_state = NULL, storage_synced_at = NULL WHERE aweme_id = ?`
      ).run(id)
    }
  })()
  enqueuePosts(awemeIds)
  db.prepare(
    `UPDATE storage_queue SET status = 'queued', attempts = 0, error = NULL
     WHERE aweme_id IN (SELECT value FROM json_each(?))`
  ).run(JSON.stringify(awemeIds))
}

/** 作品要被删除 / 重下：取出它的对象 key 并清掉记录与队列 */
export function forgetPostObjects(awemeId: string): string[] {
  const db = getDatabase()
  const keys = (
    db.prepare('SELECT key FROM post_objects WHERE aweme_id = ?').all(awemeId) as { key: string }[]
  ).map((r) => r.key)
  db.transaction(() => {
    db.prepare('DELETE FROM post_objects WHERE aweme_id = ?').run(awemeId)
    db.prepare('DELETE FROM storage_queue WHERE aweme_id = ?').run(awemeId)
    db.prepare(
      `UPDATE posts SET storage_state = NULL, storage_synced_at = NULL WHERE aweme_id = ?`
    ).run(awemeId)
  })()
  return keys
}

export function getStorageQueueStats(): StorageQueueStats {
  const db = getDatabase()
  const counts = db
    .prepare(`SELECT status, COUNT(*) AS n FROM storage_queue GROUP BY status`)
    .all() as { status: string; n: number }[]
  const by = (s: string): number => counts.find((c) => c.status === s)?.n ?? 0
  const synced = db
    .prepare(
      `SELECT COUNT(DISTINCT aweme_id) AS posts, COALESCE(SUM(size), 0) AS bytes FROM post_objects`
    )
    .get() as { posts: number; bytes: number }
  const total = (db.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n
  const cloudOnly = (
    db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE storage_state = 'cloud_only'`).get() as {
      n: number
    }
  ).n
  const recentErrors = db
    .prepare(
      `SELECT aweme_id AS awemeId, error FROM storage_queue
       WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 5`
    )
    .all() as { awemeId: string; error: string }[]
  return {
    queued: by('queued'),
    running: by('running'),
    failed: by('failed'),
    syncedPosts: synced.posts,
    syncedBytes: synced.bytes,
    totalPosts: total,
    cloudOnlyPosts: cloudOnly,
    recentErrors
  }
}
