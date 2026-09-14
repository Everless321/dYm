import type Database from 'better-sqlite3'
import { getDatabase } from './connection'

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

/**
 * 给已存在的表补列。用 table_info 判断列是否存在，而不是 try/catch 吞掉 ALTER 的所有错误，
 * 这样磁盘满、库被锁等真实故障不会被当成「列已存在」静默跳过。
 */
function ensureColumn(
  database: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (columns.some((c) => c.name === column)) return
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
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

  // 迁移：老库补列。列定义与建表语句保持一致
  ensureColumn(database, 'download_tasks', 'concurrency', 'INTEGER DEFAULT 3')
  ensureColumn(database, 'download_tasks', 'auto_sync', 'INTEGER DEFAULT 0')
  ensureColumn(database, 'download_tasks', 'sync_cron', "TEXT DEFAULT ''")
  ensureColumn(database, 'download_tasks', 'last_sync_at', 'INTEGER')

  ensureColumn(database, 'users', 'show_in_home', 'INTEGER DEFAULT 1')
  // 用户级别下载限制，0 表示使用全局设置
  ensureColumn(database, 'users', 'max_download_count', 'INTEGER DEFAULT 0')
  ensureColumn(database, 'users', 'remark', "TEXT DEFAULT ''")
  ensureColumn(database, 'users', 'avatar_path', "TEXT DEFAULT ''")
  ensureColumn(database, 'users', 'auto_sync', 'INTEGER DEFAULT 0')
  ensureColumn(database, 'users', 'sync_cron', "TEXT DEFAULT ''")
  ensureColumn(database, 'users', 'last_sync_at', 'INTEGER')
  ensureColumn(database, 'users', 'sync_status', "TEXT DEFAULT 'idle'")
  ensureColumn(database, 'users', 'live_record', 'INTEGER DEFAULT 0')
  ensureColumn(database, 'users', 'live_check_cron', "TEXT DEFAULT ''")
  ensureColumn(database, 'users', 'live_status', "TEXT DEFAULT 'idle'")
  ensureColumn(database, 'users', 'last_live_at', 'INTEGER')

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
  ensureColumn(database, 'posts', 'analysis_tags', 'TEXT')
  ensureColumn(database, 'posts', 'analysis_category', 'TEXT')
  ensureColumn(database, 'posts', 'analysis_summary', 'TEXT')
  ensureColumn(database, 'posts', 'analysis_scene', 'TEXT')
  ensureColumn(database, 'posts', 'analysis_content_level', 'INTEGER')
  ensureColumn(database, 'posts', 'analyzed_at', 'INTEGER')
  // 手动标签：与 analysis_tags 同为 JSON 字符串数组格式，默认 NULL
  ensureColumn(database, 'posts', 'manual_tags', 'TEXT')

  // posts 表索引
  database.exec(`CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)`)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_posts_sec_uid ON posts(sec_uid)`)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_posts_create_time ON posts(create_time DESC)`)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_posts_analyzed_at ON posts(analyzed_at)`)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_posts_downloaded_at ON posts(downloaded_at)`)
  // 标签工作台按分类 / 场景分面筛选
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_analysis_category ON posts(analysis_category)`
  )
  database.exec(`CREATE INDEX IF NOT EXISTS idx_posts_analysis_scene ON posts(analysis_scene)`)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_task_users_task_id ON task_users(task_id)`)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_task_users_user_id ON task_users(user_id)`)

  // 直播录制记录表
  database.exec(`
    CREATE TABLE IF NOT EXISTS live_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      sec_uid TEXT NOT NULL,
      nickname TEXT,
      room_id TEXT NOT NULL,
      title TEXT,
      quality TEXT,
      cover_path TEXT,
      file_path TEXT,
      file_size INTEGER DEFAULT 0,
      status TEXT DEFAULT 'recording',
      error TEXT,
      started_at INTEGER DEFAULT (strftime('%s', 'now')),
      ended_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  // 本地保存的直播封面图路径
  ensureColumn(database, 'live_records', 'cover_path', 'TEXT')

  database.exec(`CREATE INDEX IF NOT EXISTS idx_live_records_user_id ON live_records(user_id)`)
  database.exec(
    `CREATE INDEX IF NOT EXISTS idx_live_records_started_at ON live_records(started_at DESC)`
  )

  // 脚本定时执行计划。脚本本身是磁盘上的文件，不进数据库，这里只按 id 关联：
  // 内置为 builtin:<key>，外部为 external:<文件名>
  database.exec(`
    CREATE TABLE IF NOT EXISTS script_schedules (
      script_id TEXT PRIMARY KEY,
      cron TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    )
  `)

  // 钩子开关。脚本挂在哪个事件由文件里的 meta.hook 决定，这里只记启用/暂停。
  database.exec(`
    CREATE TABLE IF NOT EXISTS script_hook_settings (
      script_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1
    )
  `)

  // 每个脚本自己的日志留存条数。没写过就用默认 1000。
  database.exec(`
    CREATE TABLE IF NOT EXISTS script_log_settings (
      script_id TEXT PRIMARY KEY,
      log_limit INTEGER NOT NULL DEFAULT 1000
    )
  `)

  // 初始化默认设置
  const defaultSettings = [
    { key: 'douyin_cookie', value: '' },
    { key: 'grok_api_key', value: '' },
    { key: 'grok_api_url', value: 'https://api.x.ai/v1' },
    { key: 'download_path', value: '' },
    { key: 'max_download_count', value: '50' },
    { key: 'web_server_port', value: '38595' },
    // 分析相关设置
    { key: 'analysis_concurrency', value: '2' },
    { key: 'analysis_rpm', value: '10' },
    { key: 'analysis_model', value: 'grok-4-fast' },
    { key: 'analysis_slices', value: '4' },
    { key: 'analysis_prompt', value: DEFAULT_ANALYSIS_PROMPT },
    // 收藏同步（Surge 拦截收藏 → 暂存服务 → 定时拉取添加用户）
    { key: 'collect_sync_enabled', value: 'false' },
    { key: 'collect_sync_base_url', value: 'https://dymserver.everless.app' },
    { key: 'collect_sync_token', value: '' },
    { key: 'collect_sync_cron', value: '*/30 * * * *' },
    // 直播录制
    { key: 'live_output_path', value: '' },
    { key: 'live_max_duration', value: '0' }
  ]

  const insertStmt = database.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `)

  for (const setting of defaultSettings) {
    insertStmt.run(setting.key, setting.value)
  }
}
