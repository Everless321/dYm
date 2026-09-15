import type Database from 'better-sqlite3'

/**
 * AI 分析相关的表：提供方、标签正规化、分析队列。
 * 由 initDatabase 调用；只建结构，数据迁移放在各自模块（tags.ts / services/ai/providers.ts）。
 */
export function initAiSchema(database: Database.Database): void {
  // AI 提供方。credential 是 safeStorage 加密后的 base64（或 plain: 前缀的明文，加密不可用时）
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      credential TEXT,
      credential_label TEXT,
      reasoning_effort TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)

  // 标签库：name 展示名，norm 归一化键（去空白 / 全角转半角 / 英文小写）用于去重
  database.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      norm TEXT NOT NULL UNIQUE,
      is_custom INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (post_id, tag_id, source),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id, post_id)`)
  // 别名：模型输出「vlog」「VLOG」「日常vlog」这类变体时并到同一个标签
  database.exec(`
    CREATE TABLE IF NOT EXISTS tag_aliases (
      alias TEXT PRIMARY KEY,
      tag_id INTEGER NOT NULL,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
  `)

  // 分析队列
  database.exec(`
    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'analyze',
      status TEXT NOT NULL DEFAULT 'queued',
      provider_id TEXT,
      prompt TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL DEFAULT '{}',
      total INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      started_at INTEGER,
      finished_at INTEGER
    )
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS analysis_job_items (
      job_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      finished_at INTEGER,
      PRIMARY KEY (job_id, post_id),
      FOREIGN KEY (job_id) REFERENCES analysis_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )
  `)
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_analysis_job_items_status ON analysis_job_items(job_id, status)`
  )
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status, priority DESC, id)`
  )
}
