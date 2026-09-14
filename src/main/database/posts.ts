import { join, sep } from 'path'
import { existsSync, readFileSync } from 'fs'
import { getDatabase } from './connection'

// Post CRUD
export interface DbPost {
  id: number
  aweme_id: string
  user_id: number
  sec_uid: string
  nickname: string
  caption: string
  desc: string
  aweme_type: number
  create_time: string
  folder_name: string
  cover_path: string | null
  video_path: string | null
  music_path: string | null
  downloaded_at: number
  // 分析结果
  analysis_tags: string | null
  analysis_category: string | null
  analysis_summary: string | null
  analysis_scene: string | null
  analysis_content_level: number | null
  analyzed_at: number | null
  // 手动添加的标签（JSON 字符串数组，与 analysis_tags 同格式）
  manual_tags: string | null
}

export interface CreatePostInput {
  aweme_id: string
  user_id: number
  sec_uid: string
  nickname?: string
  caption?: string
  desc?: string
  aweme_type?: number
  create_time?: string
  folder_name: string
  cover_path?: string
  video_path?: string
  music_path?: string
}

export function createPost(input: CreatePostInput): DbPost {
  const database = getDatabase()
  const stmt = database.prepare(`
    INSERT INTO posts (aweme_id, user_id, sec_uid, nickname, caption, desc, aweme_type, create_time, folder_name, cover_path, video_path, music_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const result = stmt.run(
    input.aweme_id,
    input.user_id,
    input.sec_uid,
    input.nickname || '',
    input.caption || '',
    input.desc || '',
    input.aweme_type || 0,
    input.create_time || '',
    input.folder_name,
    input.cover_path || null,
    input.video_path || null,
    input.music_path || null
  )
  return getPostById(result.lastInsertRowid as number)!
}

export function getPostById(id: number): DbPost | undefined {
  const database = getDatabase()
  return database.prepare('SELECT * FROM posts WHERE id = ?').get(id) as DbPost | undefined
}

export function getPostByAwemeId(awemeId: string): DbPost | undefined {
  const database = getDatabase()
  return database.prepare('SELECT * FROM posts WHERE aweme_id = ?').get(awemeId) as
    | DbPost
    | undefined
}

export function getPostsByUserId(
  userId: number,
  page = 1,
  pageSize = 50,
  sort?: PostSortConfig
): { posts: DbPost[]; total: number } {
  const database = getDatabase()
  const offset = (page - 1) * pageSize
  const posts = database
    .prepare(`SELECT * FROM posts WHERE user_id = ? ${buildOrderBy(sort)} LIMIT ? OFFSET ?`)
    .all(userId, pageSize, offset) as DbPost[]
  const row = database
    .prepare('SELECT COUNT(*) as count FROM posts WHERE user_id = ?')
    .get(userId) as { count: number }
  return { posts, total: row.count }
}

export function getPostCountByUserId(userId: number): number {
  const database = getDatabase()
  const row = database
    .prepare('SELECT COUNT(*) as count FROM posts WHERE user_id = ?')
    .get(userId) as { count: number }
  return row.count
}

// ========== 标题修复 ==========
// polydl 返回的 desc 已被转义（特殊字符变下划线），但会额外写一份
// {aweme_id}_desc.txt 保存原始文案。历史数据可据此回填修复。

function readDescFromFile(folderPath: string | null, awemeId: string): string | null {
  if (!folderPath) return null
  try {
    const descPath = join(folderPath, `${awemeId}_desc.txt`)
    if (existsSync(descPath)) {
      return readFileSync(descPath, 'utf-8').trim()
    }
  } catch (error) {
    console.warn(`[DB] Failed to read desc file for ${awemeId}:`, error)
  }
  return null
}

export function fixAllPostTitles(): { fixed: number; skipped: number; failed: number } {
  const database = getDatabase()
  const posts = database.prepare('SELECT id, aweme_id, video_path, desc FROM posts').all() as Pick<
    DbPost,
    'id' | 'aweme_id' | 'video_path' | 'desc'
  >[]

  let fixed = 0
  let skipped = 0
  let failed = 0

  const updateStmt = database.prepare('UPDATE posts SET desc = ? WHERE id = ?')

  // 全量回填放在一个事务里：几千条 UPDATE 从逐条 fsync 变成一次提交，快一到两个数量级
  database.transaction(() => {
    for (const post of posts) {
      const original = readDescFromFile(post.video_path, post.aweme_id)
      if (original === null) {
        failed++
        continue
      }
      if (post.desc === original) {
        skipped++
        continue
      }
      try {
        updateStmt.run(original, post.id)
        fixed++
      } catch (error) {
        failed++
        console.error(`[DB] Failed to update post ${post.id}:`, error)
      }
    }
  })()

  console.log(`[DB] fixAllPostTitles: fixed=${fixed}, skipped=${skipped}, failed=${failed}`)
  return { fixed, skipped, failed }
}

export interface PostAuthor {
  sec_uid: string
  nickname: string
}

export interface PostFilters {
  secUid?: string
  tags?: string[]
  minContentLevel?: number
  maxContentLevel?: number
  analyzedOnly?: boolean
  keyword?: string
}

export type PostSortField =
  | 'create_time'
  | 'downloaded_at'
  | 'analyzed_at'
  | 'analysis_content_level'

export interface PostSortConfig {
  field: PostSortField
  order: 'ASC' | 'DESC'
}

// 白名单映射，避免 ORDER BY 注入
const SORT_COLUMNS: Record<PostSortField, string> = {
  create_time: 'create_time',
  downloaded_at: 'downloaded_at',
  analyzed_at: 'analyzed_at',
  analysis_content_level: 'analysis_content_level'
}

function buildOrderBy(sort?: PostSortConfig): string {
  const column = sort && SORT_COLUMNS[sort.field] ? SORT_COLUMNS[sort.field] : 'create_time'
  const order = sort?.order === 'ASC' ? 'ASC' : 'DESC'
  // NULL 值始终排在最后，避免未分析作品挤占头部
  return `ORDER BY ${column} ${order} NULLS LAST`
}

export function getAllPosts(
  page: number = 1,
  pageSize: number = 20,
  filters?: PostFilters,
  sort?: PostSortConfig
): { posts: DbPost[]; total: number; authors: PostAuthor[] } {
  const database = getDatabase()
  const offset = (page - 1) * pageSize

  const hasVisible = database
    .prepare('SELECT 1 AS ok FROM users WHERE show_in_home = 1 LIMIT 1')
    .get() as { ok: number } | undefined
  if (!hasVisible) {
    return { posts: [], total: 0, authors: [] }
  }

  // 下拉以 users 当前昵称为准、一人一条。posts.nickname 是下载时的快照，
  // 用户改名后同一 sec_uid 会冒出多个名字，DISTINCT(sec_uid, nickname)
  // 会让筛选列表重复，find() 还可能显示成改名前的名字。
  const authors = database
    .prepare(
      `SELECT u.sec_uid, u.nickname
       FROM users u
       WHERE u.show_in_home = 1
         AND u.sec_uid != ''
         AND u.nickname IS NOT NULL AND u.nickname != ''
         AND EXISTS (SELECT 1 FROM posts p WHERE p.sec_uid = u.sec_uid)
       ORDER BY u.nickname`
    )
    .all() as PostAuthor[]
  const nameBySec = new Map(authors.map((a) => [a.sec_uid, a.nickname]))

  // 构建查询（子查询代替把全部 sec_uid 展开成 IN (?,?,…)，可见用户上千时会顶变量上限）。
  // 一元 + 让规划器不要用 idx_posts_sec_uid 再全表临时排序，而是沿排序列索引扫到 LIMIT 即停：
  // 3 万条时首页从 ~11ms 降到 <1ms
  const conditions: string[] = [`+sec_uid IN (SELECT sec_uid FROM users WHERE show_in_home = 1)`]
  const params: unknown[] = []

  if (filters?.secUid) {
    conditions.push('sec_uid = ?')
    params.push(filters.secUid)
  }

  if (filters?.tags && filters.tags.length > 0) {
    // 标签命中 AI 或手动任一来源
    const tagConditions = filters.tags
      .map(() => '(analysis_tags LIKE ? OR manual_tags LIKE ?)')
      .join(' OR ')
    conditions.push(`(${tagConditions})`)
    filters.tags.forEach((tag) => params.push(`%"${tag}"%`, `%"${tag}"%`))
  }

  if (filters?.minContentLevel !== undefined) {
    conditions.push('analysis_content_level >= ?')
    params.push(filters.minContentLevel)
  }

  if (filters?.maxContentLevel !== undefined) {
    conditions.push('analysis_content_level <= ?')
    params.push(filters.maxContentLevel)
  }

  if (filters?.analyzedOnly) {
    conditions.push('analyzed_at IS NOT NULL')
  }

  if (filters?.keyword?.trim()) {
    // posts.nickname 存的是净化过的文件夹名（emoji/特殊字符被转义成下划线），
    // 故按真实作者名搜索时还需匹配 users.nickname。
    // 标签是 JSON 数组字符串，直接对整串模糊匹配即可命中其中任一标签。
    conditions.push(
      '(caption LIKE ? OR desc LIKE ? OR nickname LIKE ?' +
        ' OR analysis_tags LIKE ? OR manual_tags LIKE ?' +
        ' OR sec_uid IN (SELECT sec_uid FROM users WHERE nickname LIKE ?))'
    )
    const keyword = `%${filters.keyword.trim()}%`
    params.push(keyword, keyword, keyword, keyword, keyword, keyword)
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`

  const rows = database
    .prepare(`SELECT * FROM posts ${whereClause} ${buildOrderBy(sort)} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as DbPost[]

  const countRow = database
    .prepare(`SELECT COUNT(*) as count FROM posts ${whereClause}`)
    .get(...params) as { count: number }

  const posts = rows.map((p) => {
    const current = nameBySec.get(p.sec_uid)
    if (!current || current === p.nickname) return p
    return { ...p, nickname: current }
  })

  return { posts, total: countRow.count, authors }
}

export function deletePost(id: number): DbPost | undefined {
  const database = getDatabase()
  const post = getPostById(id)
  if (!post) return undefined
  database.prepare('DELETE FROM posts WHERE id = ?').run(id)
  return post
}

export function deletePostsByUserId(userId: number): number {
  const database = getDatabase()
  const result = database.prepare('DELETE FROM posts WHERE user_id = ?').run(userId)
  return result.changes
}

export interface AnalysisResult {
  tags: string[]
  category: string
  summary: string
  scene: string
  content_level: number
}

export function getUnanalyzedPostsCount(secUid?: string): number {
  const database = getDatabase()
  if (secUid) {
    const row = database
      .prepare('SELECT COUNT(*) as count FROM posts WHERE sec_uid = ? AND analyzed_at IS NULL')
      .get(secUid) as { count: number }
    return row.count
  }
  const row = database
    .prepare('SELECT COUNT(*) as count FROM posts WHERE analyzed_at IS NULL')
    .get() as { count: number }
  return row.count
}

export function getUnanalyzedPostsCountByUser(): {
  sec_uid: string
  nickname: string
  count: number
}[] {
  const database = getDatabase()
  return database
    .prepare(
      `
    SELECT sec_uid, nickname, COUNT(*) as count
    FROM posts
    WHERE analyzed_at IS NULL
    GROUP BY sec_uid
    ORDER BY count DESC
  `
    )
    .all() as { sec_uid: string; nickname: string; count: number }[]
}

export interface UserAnalysisStats {
  sec_uid: string
  nickname: string
  total: number
  analyzed: number
  unanalyzed: number
}

export function getUserAnalysisStats(): UserAnalysisStats[] {
  const database = getDatabase()

  // 所有用户一条聚合查询（分析页面不受 show_in_home 限制），避免每用户一次查询
  return database
    .prepare(
      `SELECT u.sec_uid, u.nickname,
         COUNT(p.id) as total,
         COALESCE(SUM(CASE WHEN p.analyzed_at IS NOT NULL THEN 1 ELSE 0 END), 0) as analyzed,
         COALESCE(SUM(CASE WHEN p.id IS NOT NULL AND p.analyzed_at IS NULL THEN 1 ELSE 0 END), 0) as unanalyzed
       FROM users u
       LEFT JOIN posts p ON p.sec_uid = u.sec_uid
       GROUP BY u.id
       ORDER BY u.nickname`
    )
    .all() as UserAnalysisStats[]
}

export function getTotalAnalysisStats(): { total: number; analyzed: number; unanalyzed: number } {
  const database = getDatabase()

  // 获取所有帖子的分析统计（分析页面不受 show_in_home 限制）
  const stats = database
    .prepare(
      `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN analyzed_at IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
        SUM(CASE WHEN analyzed_at IS NULL THEN 1 ELSE 0 END) as unanalyzed
      FROM posts
    `
    )
    .get() as { total: number; analyzed: number; unanalyzed: number }

  return stats || { total: 0, analyzed: 0, unanalyzed: 0 }
}

export function getUnanalyzedPosts(secUid?: string, limit?: number): DbPost[] {
  const database = getDatabase()
  let sql = 'SELECT * FROM posts WHERE analyzed_at IS NULL'
  const params: unknown[] = []

  if (secUid) {
    sql += ' AND sec_uid = ?'
    params.push(secUid)
  }

  sql += ' ORDER BY downloaded_at DESC'

  if (limit) {
    sql += ' LIMIT ?'
    params.push(limit)
  }

  return database.prepare(sql).all(...params) as DbPost[]
}

export function updatePostAnalysis(id: number, result: AnalysisResult): void {
  const database = getDatabase()
  database
    .prepare(
      `
    UPDATE posts SET
      analysis_tags = ?,
      analysis_category = ?,
      analysis_summary = ?,
      analysis_scene = ?,
      analysis_content_level = ?,
      analyzed_at = strftime('%s', 'now')
    WHERE id = ?
  `
    )
    .run(
      JSON.stringify(result.tags),
      result.category,
      result.summary,
      result.scene,
      result.content_level,
      id
    )
}

// 标准化路径前缀（确保尾部有平台分隔符）。
// 库里的路径由 join() 生成，Windows 上是反斜杠；只补 '/' 会让 LIKE 永远不匹配，迁移变成静默空操作
function normalizeDirPrefix(p: string): string {
  return p.endsWith('/') || p.endsWith('\\') ? p : p + sep
}

// 获取需要迁移的帖子数量
export function getMigrationCount(oldBasePath: string): number {
  const prefix = normalizeDirPrefix(oldBasePath)
  const database = getDatabase()
  const row = database
    .prepare(`SELECT COUNT(*) as cnt FROM posts WHERE video_path LIKE ?`)
    .get(`${prefix}%`) as { cnt: number }
  return row.cnt
}

// 批量替换路径前缀
/**
 * 把 posts 里以 oldBasePath 开头的路径改成 newBasePath。
 * 传 secUids 时只改这些作者目录下的记录：迁移时哪些作者真正搬成功了就只改哪些，
 * 否则搬失败的作者在库里会指向一个不存在的新位置。
 */
export function batchReplacePaths(
  oldBasePath: string,
  newBasePath: string,
  secUids?: string[]
): number {
  const oldPrefix = normalizeDirPrefix(oldBasePath)
  const newPrefix = normalizeDirPrefix(newBasePath)
  const database = getDatabase()
  const len = oldPrefix.length + 1
  const stmt = database.prepare(
    `UPDATE posts SET
      video_path = CASE WHEN video_path LIKE ? THEN ? || substr(video_path, ?) ELSE video_path END,
      cover_path = CASE WHEN cover_path LIKE ? THEN ? || substr(cover_path, ?) ELSE cover_path END,
      music_path = CASE WHEN music_path LIKE ? THEN ? || substr(music_path, ?) ELSE music_path END
    WHERE video_path LIKE ? OR cover_path LIKE ? OR music_path LIKE ?`
  )
  const runFor = (like: string): number =>
    stmt.run(like, newPrefix, len, like, newPrefix, len, like, newPrefix, len, like, like, like)
      .changes

  if (!secUids) return runFor(`${oldPrefix}%`)
  if (secUids.length === 0) return 0
  return database.transaction(() =>
    secUids.reduce((sum, secUid) => sum + runFor(`${oldPrefix}${secUid}${sep}%`), 0)
  )()
}

// 获取需要迁移的不重复作者目录
export function getMigrationSecUids(oldBasePath: string): string[] {
  const prefix = normalizeDirPrefix(oldBasePath)
  const database = getDatabase()
  const rows = database
    .prepare(`SELECT DISTINCT video_path FROM posts WHERE video_path LIKE ?`)
    .all(`${prefix}%`) as { video_path: string }[]

  const secUids = new Set<string>()
  for (const row of rows) {
    const relative = row.video_path.slice(prefix.length)
    const slashIdx = relative.search(/[\\/]/)
    if (slashIdx > 0) {
      secUids.add(relative.slice(0, slashIdx))
    }
  }
  return [...secUids]
}

export function deletePostByAwemeId(awemeId: string): DbPost | undefined {
  const database = getDatabase()
  const post = getPostByAwemeId(awemeId)
  if (!post) return undefined
  database.prepare('DELETE FROM posts WHERE aweme_id = ?').run(awemeId)
  return post
}

export function getPostsByUserIdAll(userId: number): DbPost[] {
  const database = getDatabase()
  return database
    .prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY downloaded_at DESC')
    .all(userId) as DbPost[]
}
