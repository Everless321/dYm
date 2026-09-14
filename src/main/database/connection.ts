import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = join(app.getPath('userData'), 'data.db')
    console.log('[Database] Path:', dbPath)
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    // SQLite 默认不检查外键，建表里声明的 ON DELETE CASCADE 必须显式开启才生效
    db.pragma('foreign_keys = ON')
  }
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
