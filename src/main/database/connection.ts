import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null
/** closeDatabase 之后置 true：退出过程中迟到的回调不能再把库悄悄重新打开 */
let closed = false

export function getDatabase(): Database.Database {
  if (closed) {
    throw new Error('数据库已关闭（应用正在退出）')
  }
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'data.db')
    console.log('[Database] Path:', dbPath)
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    // WAL 下 FULL 每个事务都 fsync；NORMAL 断电最多丢最后一次未 checkpoint 的事务，不会损坏库
    db.pragma('synchronous = NORMAL')
    // 另一个连接（如退出中的迟到写入、外部工具）持有写锁时等一会儿，而不是立刻抛 SQLITE_BUSY
    db.pragma('busy_timeout = 5000')
    // SQLite 默认不检查外键，建表里声明的 ON DELETE CASCADE 必须显式开启才生效
    db.pragma('foreign_keys = ON')
  }
  return db
}

export function closeDatabase(): void {
  closed = true
  if (db) {
    db.close()
    db = null
  }
}
