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
  // 合并 AI 与手动标签来源；每个 post 内对同名标签去重计 1 次
  return database
    .prepare(
      `SELECT tag, COUNT(*) as count FROM (
         SELECT DISTINCT posts.id as pid, j.value as tag
         FROM posts, json_each(posts.analysis_tags) j
         WHERE posts.analysis_tags IS NOT NULL AND posts.analysis_tags != '[]'
         UNION
         SELECT DISTINCT posts.id as pid, j.value as tag
         FROM posts, json_each(posts.manual_tags) j
         WHERE posts.manual_tags IS NOT NULL AND posts.manual_tags != '[]'
       )
       GROUP BY tag
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
