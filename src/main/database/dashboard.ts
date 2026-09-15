import { getDatabase } from './connection'

// ========== Dashboard Stats ==========

export interface DashboardOverview {
  totalUsers: number
  totalPosts: number
  analyzedPosts: number
  todayDownloads: number
}

export function getDashboardOverview(): DashboardOverview {
  const database = getDatabase()
  const userRow = database.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }
  const postRow = database
    .prepare(
      `SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN analyzed_at IS NOT NULL THEN 1 ELSE 0 END), 0) as analyzed,
        COALESCE(SUM(CASE WHEN downloaded_at >= strftime('%s','now','start of day') THEN 1 ELSE 0 END), 0) as today
      FROM posts`
    )
    .get() as { total: number; analyzed: number; today: number }
  return {
    totalUsers: userRow.cnt,
    totalPosts: postRow.total,
    analyzedPosts: postRow.analyzed,
    todayDownloads: postRow.today
  }
}

export interface TrendPoint {
  date: string
  count: number
}

export function getDownloadTrend(days = 30): TrendPoint[] {
  const database = getDatabase()
  return database
    .prepare(
      `SELECT date(downloaded_at, 'unixepoch', 'localtime') as date, COUNT(*) as count
       FROM posts
       WHERE downloaded_at >= strftime('%s','now','-' || ? || ' days')
       GROUP BY date ORDER BY date`
    )
    .all(days) as TrendPoint[]
}

export interface UserDistItem {
  nickname: string
  count: number
}

export function getUserVideoDistribution(limit = 10): UserDistItem[] {
  const database = getDatabase()
  return database
    .prepare(
      `SELECT nickname, COUNT(*) as count FROM posts
       GROUP BY sec_uid ORDER BY count DESC LIMIT ?`
    )
    .all(limit) as UserDistItem[]
}

export interface TagStatItem {
  tag: string
  count: number
}

export function getTopTags(limit = 20): TagStatItem[] {
  const database = getDatabase()
  // AI 与手动来源合并；同一作品上的同名标签只计 1 次
  return database
    .prepare(
      `SELECT t.name AS tag, COUNT(DISTINCT pt.post_id) AS count
       FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
       GROUP BY t.id
       ORDER BY count DESC
       LIMIT ?`
    )
    .all(limit) as TagStatItem[]
}

export interface LevelDistItem {
  level: number
  count: number
}

export function getContentLevelDistribution(): LevelDistItem[] {
  const database = getDatabase()
  return database
    .prepare(
      `SELECT analysis_content_level as level, COUNT(*) as count
       FROM posts WHERE analyzed_at IS NOT NULL AND analysis_content_level IS NOT NULL
       GROUP BY level ORDER BY level`
    )
    .all() as LevelDistItem[]
}
