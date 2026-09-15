import type Database from 'better-sqlite3'
import { ensureColumn } from './schema'

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

  // ---- v2：标签分面与置信度 ----
  ensureColumn(database, 'tags', 'facet', 'TEXT')
  ensureColumn(database, 'post_tags', 'confidence', 'REAL')

  // ---- v2：语音转写提供方、结构化分析结果、字幕、章节 ----
  database.exec(`
    CREATE TABLE IF NOT EXISTS asr_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      credential TEXT,
      max_clip_seconds INTEGER NOT NULL DEFAULT 600,
      extra_form TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `)

  // 每条作品保留最新一次的结构化结果；result 是 VideoAnalysis JSON，meta 是 AnalysisRunMeta JSON
  database.exec(`
    CREATE TABLE IF NOT EXISTS post_analysis (
      post_id INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      prompt_version TEXT NOT NULL DEFAULT '',
      model TEXT,
      asr_engine TEXT,
      result TEXT NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )
  `)

  database.exec(`
    CREATE TABLE IF NOT EXISTS post_transcripts (
      post_id INTEGER PRIMARY KEY,
      engine TEXT NOT NULL,
      language TEXT,
      partial INTEGER NOT NULL DEFAULT 0,
      coverage TEXT NOT NULL DEFAULT '[]',
      segments TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )
  `)
  // 字幕全文检索：能搜「视频里说过的话」。外部内容表模式，靠触发器同步。
  // 中文没有空格分词，unicode61 会把整句当一个词导致搜不到子串；trigram 按三字滑窗建索引，
  // 中英文都能做子串匹配（查询词需 ≥3 字，更短的走 LIKE 兜底，见 searchTranscripts）
  const ftsSql = (
    database
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'post_transcripts_fts'`
      )
      .get() as { sql: string } | undefined
  )?.sql
  if (ftsSql && !/trigram/i.test(ftsSql)) {
    database.exec('DROP TABLE post_transcripts_fts')
  }
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS post_transcripts_fts
      USING fts5(text, content='post_transcripts', content_rowid='post_id', tokenize='trigram')
  `)
  if (ftsSql && !/trigram/i.test(ftsSql)) {
    database.exec(`INSERT INTO post_transcripts_fts(post_transcripts_fts) VALUES ('rebuild')`)
  }
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS post_transcripts_ai AFTER INSERT ON post_transcripts BEGIN
      INSERT INTO post_transcripts_fts(rowid, text) VALUES (new.post_id, new.text);
    END
  `)
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS post_transcripts_ad AFTER DELETE ON post_transcripts BEGIN
      INSERT INTO post_transcripts_fts(post_transcripts_fts, rowid, text) VALUES ('delete', old.post_id, old.text);
    END
  `)
  database.exec(`
    CREATE TRIGGER IF NOT EXISTS post_transcripts_au AFTER UPDATE ON post_transcripts BEGIN
      INSERT INTO post_transcripts_fts(post_transcripts_fts, rowid, text) VALUES ('delete', old.post_id, old.text);
      INSERT INTO post_transcripts_fts(rowid, text) VALUES (new.post_id, new.text);
    END
  `)

  database.exec(`
    CREATE TABLE IF NOT EXISTS post_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      start_sec REAL NOT NULL,
      end_sec REAL NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    )
  `)
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_post_chapters_post ON post_chapters(post_id, start_sec)`
  )
}
