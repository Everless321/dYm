import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

/**
 * better-sqlite3 是按 Electron ABI 编译的，vitest（Node）加载不了；
 * 用 Node 自带的 node:sqlite 包一层同名 API，让 storage.ts 里的真实 SQL 在真实 SQLite 上跑。
 */
function adapt(db: DatabaseSync): unknown {
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => {
      const stmt = db.prepare(sql)
      return {
        run: (...args: never[]) => stmt.run(...args),
        get: (...args: never[]) => stmt.get(...args),
        all: (...args: never[]) => stmt.all(...args)
      }
    },
    transaction:
      <T>(fn: () => T) =>
      (): T => {
        db.exec('BEGIN')
        try {
          const result = fn()
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
  }
}

let raw: DatabaseSync
vi.mock('./connection', () => ({ getDatabase: () => adapt(raw) }))

const storage = await import('./storage')

function addPost(awemeId: string, downloadedAt = 1000, state: string | null = null): void {
  raw
    .prepare(
      `INSERT INTO posts (aweme_id, sec_uid, folder_name, downloaded_at, storage_state)
       VALUES (?, 'SEC', ?, ?, ?)`
    )
    .run(awemeId, awemeId, downloadedAt, state)
}

function queueStatus(awemeId: string): string | undefined {
  return (
    raw.prepare('SELECT status FROM storage_queue WHERE aweme_id = ?').get(awemeId) as
      | { status: string }
      | undefined
  )?.status
}

function postState(awemeId: string): string | null {
  return (
    raw.prepare('SELECT storage_state AS s FROM posts WHERE aweme_id = ?').get(awemeId) as {
      s: string | null
    }
  ).s
}

const obj = (key: string, size = 10): Parameters<typeof storage.recordPostSynced>[1][number] => ({
  key,
  kind: 'video',
  idx: 0,
  size,
  content_type: 'video/mp4'
})

beforeEach(() => {
  raw = new DatabaseSync(':memory:')
  raw.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aweme_id TEXT UNIQUE NOT NULL,
      sec_uid TEXT NOT NULL,
      folder_name TEXT,
      downloaded_at INTEGER,
      storage_state TEXT,
      storage_synced_at INTEGER
    )
  `)
  storage.initStorageSchema(adapt(raw) as never)
})

describe('上传队列', () => {
  it('上传现有作品只排从没上过云的，已上云 / 本地已清理的不动', () => {
    addPost('a')
    addPost('b', 1000, 'synced')
    addPost('c', 1000, 'cloud_only')
    expect(storage.enqueueUnsyncedPosts()).toBe(1)
    expect(queueStatus('a')).toBe('queued')
    expect(queueStatus('b')).toBeUndefined()
    expect(queueStatus('c')).toBeUndefined()
  })

  it('领取把 queued 改成 running 并计次；作品记录已删的直接丢掉', () => {
    addPost('a')
    storage.enqueuePosts(['gone', 'a'])
    expect(storage.claimNextUpload()).toEqual({ aweme_id: 'a', sec_uid: 'SEC', folder_name: 'a' })
    expect(queueStatus('a')).toBe('running')
    expect(queueStatus('gone')).toBeUndefined()
    expect(storage.claimNextUpload()).toBeNull()
  })

  it('重复入队只会把 failed 重置回 queued，不打断正在传的', () => {
    addPost('a')
    addPost('b')
    storage.enqueuePosts(['a', 'b'])
    storage.claimNextUpload()
    storage.markUploadFailed('b', 'x')
    storage.enqueuePosts(['a', 'b'])
    expect(queueStatus('a')).toBe('running')
    expect(queueStatus('b')).toBe('queued')
  })

  it('重启后正在传的回到队列', () => {
    addPost('a')
    storage.enqueuePosts(['a'])
    storage.claimNextUpload()
    expect(storage.requeueInterruptedUploads()).toBe(1)
    expect(queueStatus('a')).toBe('queued')
  })
})

describe('上云记录', () => {
  it('记录对象、标记作品状态与队列完成，同一作品重复记录会整体替换', () => {
    addPost('a')
    storage.enqueuePosts(['a'])
    storage.recordPostSynced('a', [obj('k1'), obj('k2')])
    storage.recordPostSynced('a', [obj('k1', 11)])
    expect(storage.getPostObjects('a').map((o) => [o.key, o.size])).toEqual([['k1', 11]])
    expect(postState('a')).toBe('synced')
    expect(queueStatus('a')).toBe('done')
  })

  it('从桶里认领的记为 cloud_only', () => {
    addPost('a')
    storage.recordPostSynced('a', [obj('k1')], 'cloud_only')
    expect(postState('a')).toBe('cloud_only')
  })

  it('保留期清理只挑已上云、上云时间早于截止点的', () => {
    addPost('old')
    addPost('new')
    addPost('cloud')
    storage.recordPostSynced('old', [obj('o')])
    storage.recordPostSynced('new', [obj('n')])
    storage.recordPostSynced('cloud', [obj('c')], 'cloud_only')
    raw.exec(`UPDATE posts SET storage_synced_at = 100 WHERE aweme_id IN ('old', 'cloud')`)
    raw.exec(`UPDATE posts SET storage_synced_at = 900 WHERE aweme_id = 'new'`)
    expect(storage.listPruneCandidates(500, 10).map((p) => p.aweme_id)).toEqual(['old'])
  })

  it('按比例清理按下载时间从早到晚排', () => {
    addPost('b', 2000)
    addPost('a', 1000)
    storage.recordPostSynced('a', [obj('ka')])
    storage.recordPostSynced('b', [obj('kb')])
    expect(storage.listSyncedPostsOldestFirst().map((p) => p.aweme_id)).toEqual(['a', 'b'])
  })

  it('核对不通过的作品清掉记录并强制重新排队（即使之前已完成）', () => {
    addPost('a')
    storage.enqueuePosts(['a'])
    storage.recordPostSynced('a', [obj('k1')])
    storage.resetPostSync(['a'])
    expect(storage.getPostObjects('a')).toEqual([])
    expect(postState('a')).toBeNull()
    expect(queueStatus('a')).toBe('queued')
  })

  it('删除作品时取出 key 并清掉记录与队列', () => {
    addPost('a')
    storage.enqueuePosts(['a'])
    storage.recordPostSynced('a', [obj('k1'), obj('k2')])
    expect(storage.forgetPostObjects('a').sort()).toEqual(['k1', 'k2'])
    expect(storage.getPostObjects('a')).toEqual([])
    expect(queueStatus('a')).toBeUndefined()
    expect(storage.getAwemeIdsWithCloudCopy().has('a')).toBe(false)
  })

  it('启动时清掉作品记录已不存在的对象记录', () => {
    addPost('a')
    storage.recordPostSynced('a', [obj('k1')])
    raw.exec(`DELETE FROM posts WHERE aweme_id = 'a'`)
    storage.initStorageSchema(adapt(raw) as never)
    expect(storage.getPostObjects('a')).toEqual([])
  })

  it('统计', () => {
    addPost('a')
    addPost('b')
    addPost('c')
    storage.enqueuePosts(['a', 'b'])
    storage.recordPostSynced('a', [obj('k1', 100), obj('k2', 50)], 'cloud_only')
    storage.claimNextUpload()
    storage.markUploadFailed('b', 'boom')
    expect(storage.getStorageQueueStats()).toEqual({
      queued: 0,
      running: 0,
      failed: 1,
      syncedPosts: 1,
      syncedBytes: 150,
      totalPosts: 3,
      cloudOnlyPosts: 1,
      recentErrors: [{ awemeId: 'b', error: 'boom' }]
    })
  })
})
