import { getDatabase } from './connection'
import { getSetting, setSetting } from './settings'
import type { DbPost } from './posts'

/**
 * 标签存储：tags / post_tags / tag_aliases 三张表是事实来源。
 * posts.analysis_tags / manual_tags 两个 JSON 列保留为冗余缓存（渲染端、网页端、脚本 API 都在读），
 * 任何 post_tags 写入后都通过 syncPostTagColumns 回写，保证两边一致。
 */

export type TagSource = 'ai' | 'manual'

export function parseTagJSON(s: string | null): string[] {
  if (!s) return []
  try {
    const arr = JSON.parse(s)
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

// ==================== 归一化 ====================

const MAX_TAG_LENGTH = 30

/**
 * 清洗模型 / 用户输入的标签：去首尾空白与 # 前缀、全角转半角（NFKC）、去掉内部空白、
 * 去掉首尾标点。返回展示名与归一化键（英文小写），空或过长返回 null。
 */
export function normalizeTagName(raw: string): { name: string; norm: string } | null {
  if (typeof raw !== 'string') return null
  let name = raw.normalize('NFKC').trim()
  name = name.replace(/^[#＃\s]+/, '')
  name = name.replace(/\s+/g, '')
  name = name.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
  if (!name || name.length > MAX_TAG_LENGTH) return null
  return { name, norm: name.toLowerCase() }
}

interface TagRow {
  id: number
  name: string
  norm: string
  is_custom: number
}

function findTagByNorm(norm: string): TagRow | undefined {
  return getDatabase().prepare('SELECT * FROM tags WHERE norm = ?').get(norm) as TagRow | undefined
}

function findTagByAlias(norm: string): TagRow | undefined {
  return getDatabase()
    .prepare('SELECT t.* FROM tag_aliases a JOIN tags t ON t.id = a.tag_id WHERE a.alias = ?')
    .get(norm) as TagRow | undefined
}

/** 按名字找标签：先查别名再查归一化键。找不到返回 undefined */
export function resolveTag(raw: string): TagRow | undefined {
  const normalized = normalizeTagName(raw)
  if (!normalized) return undefined
  return findTagByAlias(normalized.norm) ?? findTagByNorm(normalized.norm)
}

/** 找不到就建。返回标签 id */
export function ensureTag(raw: string, options: { custom?: boolean } = {}): number | null {
  const normalized = normalizeTagName(raw)
  if (!normalized) return null
  const existing = findTagByAlias(normalized.norm) ?? findTagByNorm(normalized.norm)
  if (existing) {
    if (options.custom && !existing.is_custom) {
      getDatabase().prepare('UPDATE tags SET is_custom = 1 WHERE id = ?').run(existing.id)
    }
    return existing.id
  }
  const result = getDatabase()
    .prepare('INSERT INTO tags (name, norm, is_custom) VALUES (?, ?, ?)')
    .run(normalized.name, normalized.norm, options.custom ? 1 : 0)
  return Number(result.lastInsertRowid)
}

// ==================== post_tags 写入 ====================

/** 把 post_tags 的现状回写到 posts.analysis_tags / manual_tags（JSON 数组，空则 NULL） */
export function syncPostTagColumns(postIds: number[]): void {
  if (!postIds.length) return
  const database = getDatabase()
  const select = database.prepare(
    `SELECT pt.source, t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
     WHERE pt.post_id = ? ORDER BY pt.created_at, pt.rowid`
  )
  const update = database.prepare(
    'UPDATE posts SET analysis_tags = ?, manual_tags = ? WHERE id = ?'
  )
  for (const postId of postIds) {
    const rows = select.all(postId) as { source: TagSource; name: string }[]
    const ai = rows.filter((r) => r.source === 'ai').map((r) => r.name)
    const manual = rows.filter((r) => r.source === 'manual').map((r) => r.name)
    update.run(
      ai.length ? JSON.stringify(ai) : null,
      manual.length ? JSON.stringify(manual) : null,
      postId
    )
  }
}

/**
 * 用一组名字整体替换某作品某来源的标签。
 * mode=closed 时只接受标签库里已有（含别名）的标签，用于约束模型输出。返回实际写入的展示名。
 */
export function replacePostTags(
  postId: number,
  source: TagSource,
  names: string[],
  mode: 'open' | 'closed' = 'open',
  details?: Map<string, { facet: string; confidence: number }>
): string[] {
  const database = getDatabase()
  const ids: number[] = []
  const detailOf = new Map<number, { facet: string; confidence: number }>()
  const kept: string[] = []
  const seen = new Set<number>()
  for (const raw of names) {
    const id = mode === 'closed' ? (resolveTag(raw)?.id ?? null) : ensureTag(raw)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    const detail = details?.get(raw)
    if (detail) detailOf.set(id, detail)
  }
  database.prepare('DELETE FROM post_tags WHERE post_id = ? AND source = ?').run(postId, source)
  const insert = database.prepare(
    'INSERT OR IGNORE INTO post_tags (post_id, tag_id, source, created_at, confidence) VALUES (?, ?, ?, ?, ?)'
  )
  const nameOf = database.prepare('SELECT name FROM tags WHERE id = ?')
  // 分面只在标签还没有分面时写入：同一个标签在不同视频里被模型归到不同分面时，以第一次为准，避免来回跳
  const setFacet = database.prepare(
    `UPDATE tags SET facet = ? WHERE id = ? AND (facet IS NULL OR facet = '')`
  )
  // created_at 递增保证回写 JSON 时保持模型输出顺序（基础标签在前、组合标签在后）
  const base = Math.floor(Date.now() / 1000)
  ids.forEach((id, index) => {
    const detail = detailOf.get(id)
    insert.run(postId, id, source, base + index, detail ? detail.confidence : null)
    if (detail?.facet) setFacet.run(detail.facet, id)
    kept.push((nameOf.get(id) as { name: string }).name)
  })
  syncPostTagColumns([postId])
  return kept
}

// 写入单个 post 的标签（按需更新 AI / 手动来源）。不改 analyzed_at。
export function setPostTags(id: number, input: { aiTags?: string[]; manualTags?: string[] }): void {
  const database = getDatabase()
  database.transaction(() => {
    if (input.aiTags !== undefined) replacePostTags(id, 'ai', input.aiTags)
    if (input.manualTags !== undefined) replacePostTags(id, 'manual', input.manualTags)
  })()
}

// 批量给视频追加手动标签（不动 AI 标签）
export function addTagsToPosts(postIds: number[], tags: string[]): number {
  if (!postIds.length) return 0
  const database = getDatabase()
  const tagIds = Array.from(
    new Set(tags.map((t) => ensureTag(t)).filter((id): id is number => id !== null))
  )
  if (!tagIds.length) return 0
  const insert = database.prepare(
    "INSERT OR IGNORE INTO post_tags (post_id, tag_id, source) VALUES (?, ?, 'manual')"
  )
  database.transaction(() => {
    for (const postId of postIds) for (const tagId of tagIds) insert.run(postId, tagId)
    syncPostTagColumns(postIds)
  })()
  return postIds.length
}

export type ClearTagScope = 'all' | 'ai' | 'manual'

// 批量清除标签。清 AI 时连带重置分析字段与 analyzed_at（回到未分析，便于重标队列捡到）。
export function clearTags(postIds: number[], scope: ClearTagScope): number {
  if (!postIds.length) return 0
  const database = getDatabase()
  const placeholders = postIds.map(() => '?').join(',')
  database.transaction(() => {
    if (scope === 'all') {
      database.prepare(`DELETE FROM post_tags WHERE post_id IN (${placeholders})`).run(...postIds)
    } else {
      database
        .prepare(`DELETE FROM post_tags WHERE source = ? AND post_id IN (${placeholders})`)
        .run(scope, ...postIds)
    }
    if (scope === 'ai' || scope === 'all') {
      database
        .prepare(
          `UPDATE posts SET analysis_category = NULL, analysis_summary = NULL, analysis_scene = NULL,
             analysis_content_level = NULL, analysis_raw = NULL, analysis_model = NULL, analyzed_at = NULL
           WHERE id IN (${placeholders})`
        )
        .run(...postIds)
    }
    syncPostTagColumns(postIds)
  })()
  return postIds.length
}

// ==================== 标签库维护 ====================

function postIdsOfTags(tagIds: number[]): number[] {
  if (!tagIds.length) return []
  const rows = getDatabase()
    .prepare(
      `SELECT DISTINCT post_id FROM post_tags WHERE tag_id IN (${tagIds.map(() => '?').join(',')})`
    )
    .all(...tagIds) as { post_id: number }[]
  return rows.map((r) => r.post_id)
}

/** 把 from 的所有关联并入 into，并把 from 的名字登记为 into 的别名，最后删掉 from */
function mergeTagInto(fromId: number, intoId: number): void {
  if (fromId === intoId) return
  const database = getDatabase()
  const from = database.prepare('SELECT * FROM tags WHERE id = ?').get(fromId) as TagRow | undefined
  if (!from) return
  database
    .prepare(
      `INSERT OR IGNORE INTO post_tags (post_id, tag_id, source, created_at)
       SELECT post_id, ?, source, created_at FROM post_tags WHERE tag_id = ?`
    )
    .run(intoId, fromId)
  database.prepare('DELETE FROM post_tags WHERE tag_id = ?').run(fromId)
  database.prepare('UPDATE tag_aliases SET tag_id = ? WHERE tag_id = ?').run(intoId, fromId)
  database.prepare('DELETE FROM tags WHERE id = ?').run(fromId)
  database
    .prepare('INSERT OR REPLACE INTO tag_aliases (alias, tag_id) VALUES (?, ?)')
    .run(from.norm, intoId)
}

/** 重命名；若新名字已存在则等同于合并。返回受影响作品数 */
export function renameTag(oldName: string, newName: string): number {
  const target = normalizeTagName(newName)
  const source = resolveTag(oldName)
  if (!target || !source) return 0
  if (source.norm === target.norm && source.name === target.name) return 0
  const database = getDatabase()
  return database.transaction(() => {
    const affected = postIdsOfTags([source.id])
    const existing = findTagByNorm(target.norm)
    if (existing && existing.id !== source.id) {
      mergeTagInto(source.id, existing.id)
    } else {
      database
        .prepare('UPDATE tags SET name = ?, norm = ? WHERE id = ?')
        .run(target.name, target.norm, source.id)
      database.prepare('DELETE FROM tag_aliases WHERE alias = ?').run(target.norm)
      if (source.norm !== target.norm) {
        database
          .prepare('INSERT OR REPLACE INTO tag_aliases (alias, tag_id) VALUES (?, ?)')
          .run(source.norm, source.id)
      }
    }
    syncPostTagColumns(affected)
    return affected.length
  })()
}

export function mergeTags(names: string[], into: string): number {
  const database = getDatabase()
  return database.transaction(() => {
    const intoId = ensureTag(into)
    if (intoId === null) return 0
    const sources = names
      .map((n) => resolveTag(n))
      .filter((t): t is TagRow => !!t && t.id !== intoId)
    const affected = postIdsOfTags([...sources.map((s) => s.id), intoId])
    for (const s of sources) mergeTagInto(s.id, intoId)
    syncPostTagColumns(affected)
    return affected.length
  })()
}

// 删除标签：连同所有作品上的关联与别名一起删
export function deleteTags(names: string[]): number {
  const database = getDatabase()
  return database.transaction(() => {
    const targets = names.map((n) => resolveTag(n)).filter((t): t is TagRow => !!t)
    if (!targets.length) return 0
    const ids = targets.map((t) => t.id)
    const affected = postIdsOfTags(ids)
    database.prepare(`DELETE FROM tags WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
    syncPostTagColumns(affected)
    return affected.length
  })()
}

/** 自定义标签：用户在标签库里手动新建的（is_custom=1），可能还没用在任何作品上 */
export function getCustomTags(): string[] {
  const rows = getDatabase()
    .prepare('SELECT name FROM tags WHERE is_custom = 1 ORDER BY name')
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

export function addCustomTag(name: string): void {
  ensureTag(name, { custom: true })
}

export function removeCustomTag(name: string): void {
  const tag = resolveTag(name)
  if (tag) getDatabase().prepare('UPDATE tags SET is_custom = 0 WHERE id = ?').run(tag.id)
}

export interface TagAliasItem {
  alias: string
  tag: string
}

export function getTagAliases(): TagAliasItem[] {
  return getDatabase()
    .prepare(
      'SELECT a.alias, t.name AS tag FROM tag_aliases a JOIN tags t ON t.id = a.tag_id ORDER BY t.name, a.alias'
    )
    .all() as TagAliasItem[]
}

/** 登记别名：以后模型输出 alias 会并到 tag 上。tag 不存在会创建 */
export function addTagAlias(alias: string, tag: string): void {
  const normalized = normalizeTagName(alias)
  const tagId = ensureTag(tag)
  if (!normalized || tagId === null) return
  const database = getDatabase()
  database.transaction(() => {
    // 别名如果本身已经是一个独立标签，等同于把它合并进去
    const existing = findTagByNorm(normalized.norm)
    if (existing && existing.id !== tagId) {
      const affected = postIdsOfTags([existing.id])
      mergeTagInto(existing.id, tagId)
      syncPostTagColumns(affected)
    } else if (!existing) {
      database
        .prepare('INSERT OR REPLACE INTO tag_aliases (alias, tag_id) VALUES (?, ?)')
        .run(normalized.norm, tagId)
    }
  })()
}

export function removeTagAlias(alias: string): void {
  const normalized = normalizeTagName(alias)
  if (!normalized) return
  getDatabase().prepare('DELETE FROM tag_aliases WHERE alias = ?').run(normalized.norm)
}

// ==================== 旧数据迁移 ====================

const MIGRATED_KEY = 'tags_normalized_v1'

/**
 * 首次启动新版本：把 posts.analysis_tags / manual_tags 的 JSON 数组灌进 tags / post_tags，
 * 旧的 tag_library_custom 设置里的自定义标签也一并导入。幂等，跑过一次后记标记。
 */
export function migrateTagsFromJsonColumns(): void {
  if (getSetting(MIGRATED_KEY) === '1') return
  const database = getDatabase()
  const rows = database
    .prepare(
      `SELECT id, analysis_tags, manual_tags FROM posts
       WHERE analysis_tags IS NOT NULL OR manual_tags IS NOT NULL`
    )
    .all() as { id: number; analysis_tags: string | null; manual_tags: string | null }[]
  const insert = database.prepare(
    'INSERT OR IGNORE INTO post_tags (post_id, tag_id, source, created_at) VALUES (?, ?, ?, ?)'
  )
  const started = Date.now()
  database.transaction(() => {
    for (const row of rows) {
      const sources: [TagSource, string[]][] = [
        ['ai', parseTagJSON(row.analysis_tags)],
        ['manual', parseTagJSON(row.manual_tags)]
      ]
      for (const [source, names] of sources) {
        names.forEach((name, index) => {
          const tagId = ensureTag(name)
          if (tagId !== null) insert.run(row.id, tagId, source, index)
        })
      }
    }
    for (const name of parseTagJSON(getSetting('tag_library_custom')))
      ensureTag(name, { custom: true })
    // 归一化可能把「Vlog」「vlog」并成一个，回写让 JSON 列与真相一致
    syncPostTagColumns(rows.map((r) => r.id))
    database.prepare(`DELETE FROM settings WHERE key = 'tag_library_custom'`).run()
    setSetting(MIGRATED_KEY, '1')
  })()
  if (rows.length) {
    console.log(
      `[Database] 标签正规化迁移完成：${rows.length} 条作品，耗时 ${Date.now() - started}ms`
    )
  }
}

// ==================== 查询 ====================

export function getAllTags(): string[] {
  // 可见用户的作品中的所有标签
  const rows = getDatabase()
    .prepare(
      `SELECT DISTINCT t.name FROM post_tags pt
       JOIN tags t ON t.id = pt.tag_id
       JOIN posts p ON p.id = pt.post_id
       WHERE p.sec_uid IN (SELECT sec_uid FROM users WHERE show_in_home = 1)
       ORDER BY t.name`
    )
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

export interface TagOverviewStats {
  totalVideos: number
  tagged: number
  untagged: number
  tagKinds: number
}

export function getTagOverviewStats(): TagOverviewStats {
  const database = getDatabase()
  const row = database
    .prepare(
      `SELECT COUNT(*) as total,
        SUM(CASE WHEN analysis_tags IS NOT NULL OR manual_tags IS NOT NULL THEN 1 ELSE 0 END) as tagged
       FROM posts`
    )
    .get() as { total: number; tagged: number }
  const kinds = database.prepare('SELECT COUNT(DISTINCT tag_id) as c FROM post_tags').get() as {
    c: number
  }
  const total = row?.total || 0
  const tagged = row?.tagged || 0
  return { totalVideos: total, tagged, untagged: total - tagged, tagKinds: kinds.c }
}

export interface UserTagStats {
  sec_uid: string
  nickname: string
  avatar: string
  avatar_path: string
  total: number
  tagged: number
  untagged: number
}

export function getUserTagStats(): UserTagStats[] {
  const rows = getDatabase()
    .prepare(
      `SELECT u.sec_uid, u.nickname, u.avatar, u.avatar_path,
         COUNT(p.id) as total,
         COALESCE(SUM(CASE WHEN p.analysis_tags IS NOT NULL OR p.manual_tags IS NOT NULL THEN 1 ELSE 0 END), 0) as tagged
       FROM users u
       LEFT JOIN posts p ON p.sec_uid = u.sec_uid
       GROUP BY u.sec_uid
       ORDER BY u.nickname`
    )
    .all() as Omit<UserTagStats, 'untagged'>[]
  return rows.map((r) => ({ ...r, untagged: r.total - r.tagged }))
}

export interface TagFrequencyItem {
  tag: string
  count: number
  source: 'ai' | 'manual' | 'both'
  categories: string[]
}

// 标签频率（每 post 计 1 次）+ 来源标记。传 secUid 则只统计该用户。
export function getTagsWithFrequency(secUid?: string): TagFrequencyItem[] {
  const rows = getDatabase()
    .prepare(
      `SELECT t.name AS tag,
         COUNT(DISTINCT pt.post_id) AS count,
         MAX(CASE WHEN pt.source = 'ai' THEN 1 ELSE 0 END) AS has_ai,
         MAX(CASE WHEN pt.source = 'manual' THEN 1 ELSE 0 END) AS has_manual,
         GROUP_CONCAT(DISTINCT NULLIF(TRIM(p.analysis_category), '')) AS cats
       FROM post_tags pt
       JOIN tags t ON t.id = pt.tag_id
       JOIN posts p ON p.id = pt.post_id
       ${secUid ? 'WHERE p.sec_uid = ?' : ''}
       GROUP BY t.id
       ORDER BY count DESC, t.name`
    )
    .all(...(secUid ? [secUid] : [])) as {
    tag: string
    count: number
    has_ai: number
    has_manual: number
    cats: string | null
  }[]
  return rows.map((r) => ({
    tag: r.tag,
    count: r.count,
    source: r.has_ai && r.has_manual ? 'both' : r.has_ai ? 'ai' : 'manual',
    categories: r.cats ? r.cats.split(',') : []
  }))
}

export interface TagLibraryStats {
  totalTags: number
  categories: number
  usedTags: number
  unusedTags: number
}

export function getTagLibraryStats(): TagLibraryStats {
  const database = getDatabase()
  const counts = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM tags) AS total,
         (SELECT COUNT(DISTINCT tag_id) FROM post_tags) AS used,
         (SELECT COUNT(DISTINCT analysis_category) FROM posts
            WHERE analysis_category IS NOT NULL AND analysis_category != '') AS categories`
    )
    .get() as { total: number; used: number; categories: number }
  return {
    totalTags: counts.total,
    categories: counts.categories,
    usedTags: counts.used,
    unusedTags: counts.total - counts.used
  }
}

export interface TagCategoryItem {
  category: string
  count: number
}

export function getTagCategories(): TagCategoryItem[] {
  return getDatabase()
    .prepare(
      `SELECT COALESCE(NULLIF(analysis_category, ''), '未分类') as category, COUNT(*) as count
       FROM posts WHERE analysis_tags IS NOT NULL OR manual_tags IS NOT NULL
       GROUP BY category ORDER BY count DESC`
    )
    .all() as TagCategoryItem[]
}

/** 标注状态：按 analysis_tags / manual_tags 的有无组合（两列是 post_tags 的同步缓存） */
export type TagStatusFilter = 'all' | 'untagged' | 'tagged' | 'ai' | 'manual' | 'both'

const TAG_STATUS_SQL: Record<Exclude<TagStatusFilter, 'all'>, string> = {
  untagged: 'analysis_tags IS NULL AND manual_tags IS NULL',
  tagged: '(analysis_tags IS NOT NULL OR manual_tags IS NOT NULL)',
  ai: 'analysis_tags IS NOT NULL AND manual_tags IS NULL',
  manual: 'manual_tags IS NOT NULL AND analysis_tags IS NULL',
  both: 'analysis_tags IS NOT NULL AND manual_tags IS NOT NULL'
}

export type TagPostSort = 'downloaded' | 'published' | 'analyzed' | 'level'

const TAG_SORT_SQL: Record<TagPostSort, string> = {
  downloaded: 'downloaded_at DESC',
  published: 'create_time DESC',
  analyzed: 'analyzed_at DESC',
  level: 'analysis_content_level DESC'
}

export interface TagPostFilters {
  secUid?: string
  tags?: string[]
  /** any=命中任一标签（默认），all=必须同时含全部标签 */
  tagMode?: 'any' | 'all'
  keyword?: string
  status?: TagStatusFilter
  categories?: string[]
  scenes?: string[]
  minLevel?: number
  maxLevel?: number
  sort?: TagPostSort
}

type TagFilterDimension = 'user' | 'tags' | 'status' | 'categories' | 'scenes' | 'level'

/** 「作品带有指定标签」的 SQL 片段：走 post_tags 索引而不是对 JSON 文本 LIKE */
export function tagMatchSql(tagNames: string[], mode: 'any' | 'all', params: unknown[]): string {
  // 先把名字（含别名）解析成 id；库里没有的标签不可能命中任何作品
  const ids = tagNames.map((t) => resolveTag(t)?.id ?? null)
  if (mode === 'all') {
    return ids
      .map((id) => {
        if (id === null) return '0'
        params.push(id)
        return `EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = posts.id AND pt.tag_id = ?)`
      })
      .join(' AND ')
  }
  const known = ids.filter((id): id is number => id !== null)
  if (!known.length) return '0'
  params.push(...known)
  return `EXISTS (SELECT 1 FROM post_tags pt
            WHERE pt.post_id = posts.id AND pt.tag_id IN (${known.map(() => '?').join(',')}))`
}

/** 「作品的某个标签名包含关键词」 */
export function tagKeywordSql(params: unknown[], keywordLike: string): string {
  params.push(keywordLike)
  return `EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
            WHERE pt.post_id = posts.id AND t.name LIKE ?)`
}

// 把筛选条件编译成 WHERE 子句。omit 里的维度会被跳过（分面计数时不能被自己约束）。
function buildTagWhere(
  filters: TagPostFilters | undefined,
  omit: TagFilterDimension[] = []
): { clause: string; params: unknown[] } {
  const skip = new Set(omit)
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.secUid && !skip.has('user')) {
    conditions.push('posts.sec_uid = ?')
    params.push(filters.secUid)
  }

  if (filters?.tags?.length && !skip.has('tags')) {
    conditions.push(
      `(${tagMatchSql(filters.tags, filters.tagMode === 'all' ? 'all' : 'any', params)})`
    )
  }

  if (filters?.status && filters.status !== 'all' && !skip.has('status')) {
    conditions.push(`(${TAG_STATUS_SQL[filters.status]})`)
  }

  if (filters?.categories?.length && !skip.has('categories')) {
    const hasUncategorized = filters.categories.includes('未分类')
    const named = filters.categories.filter((c) => c !== '未分类')
    const parts: string[] = []
    if (named.length) {
      parts.push(`analysis_category IN (${named.map(() => '?').join(',')})`)
      params.push(...named)
    }
    if (hasUncategorized) parts.push(`(analysis_category IS NULL OR analysis_category = '')`)
    if (parts.length) conditions.push(`(${parts.join(' OR ')})`)
  }

  if (filters?.scenes?.length && !skip.has('scenes')) {
    conditions.push(`analysis_scene IN (${filters.scenes.map(() => '?').join(',')})`)
    params.push(...filters.scenes)
  }

  if (!skip.has('level')) {
    if (filters?.minLevel !== undefined) {
      conditions.push('analysis_content_level >= ?')
      params.push(filters.minLevel)
    }
    if (filters?.maxLevel !== undefined) {
      conditions.push('analysis_content_level <= ?')
      params.push(filters.maxLevel)
    }
  }

  // 关键词是自由文本，任何分面统计都应受它约束，故不参与 omit
  if (filters?.keyword?.trim()) {
    const kw = `%${filters.keyword.trim()}%`
    params.push(kw, kw)
    conditions.push(`(caption LIKE ? OR desc LIKE ? OR ${tagKeywordSql(params, kw)})`)
  }

  return {
    clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  }
}

// 标签管理用的作品查询（不受 show_in_home 限制）。secUid 可选 —— 不传即跨用户全库查询。
export function queryPostsForTags(
  filters?: TagPostFilters,
  page = 1,
  pageSize = 60
): { posts: DbPost[]; total: number } {
  const database = getDatabase()
  const offset = (page - 1) * pageSize
  const { clause, params } = buildTagWhere(filters)
  const orderBy = TAG_SORT_SQL[filters?.sort || 'downloaded']
  const posts = database
    .prepare(`SELECT * FROM posts ${clause} ORDER BY ${orderBy} NULLS LAST LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset) as DbPost[]
  const countRow = database
    .prepare(`SELECT COUNT(*) as count FROM posts ${clause}`)
    .get(...params) as { count: number }
  return { posts, total: countRow.count }
}

/** 同筛选条件下的全部作品 id，顺序与 queryPostsForTags 一致（详情页上/下一条用） */
export function queryPostIdsForTags(filters?: TagPostFilters): number[] {
  const { clause, params } = buildTagWhere(filters)
  const orderBy = TAG_SORT_SQL[filters?.sort || 'downloaded']
  const rows = getDatabase()
    .prepare(`SELECT id FROM posts ${clause} ORDER BY ${orderBy} NULLS LAST`)
    .all(...params) as { id: number }[]
  return rows.map((row) => row.id)
}

export interface TagFilterFacets {
  users: { sec_uid: string; nickname: string; count: number }[]
  tags: { tag: string; count: number }[]
  categories: TagCategoryItem[]
  scenes: { scene: string; count: number }[]
  statusCounts: Record<Exclude<TagStatusFilter, 'all'>, number>
  total: number
}

// 筛选栏的可选项 + 计数，一次 IPC 查完。每个维度的计数都排除自身条件（标准分面语义）。
export function getTagFilterFacets(filters?: TagPostFilters): TagFilterFacets {
  const database = getDatabase()

  const userScope = buildTagWhere(filters, ['user'])
  const users = database
    .prepare(
      `SELECT posts.sec_uid, COALESCE(u.nickname, posts.nickname) as nickname, COUNT(*) as count
       FROM posts LEFT JOIN users u ON u.sec_uid = posts.sec_uid
       ${userScope.clause}
       GROUP BY posts.sec_uid ORDER BY count DESC`
    )
    .all(...userScope.params) as TagFilterFacets['users']

  const tagScope = buildTagWhere(filters, ['tags'])
  const tags = database
    .prepare(
      `SELECT t.name AS tag, COUNT(DISTINCT pt.post_id) AS count
       FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE pt.post_id IN (SELECT posts.id FROM posts ${tagScope.clause})
       GROUP BY t.id ORDER BY count DESC, t.name`
    )
    .all(...tagScope.params) as TagFilterFacets['tags']

  const catScope = buildTagWhere(filters, ['categories'])
  const categories = database
    .prepare(
      `SELECT COALESCE(NULLIF(analysis_category, ''), '未分类') as category, COUNT(*) as count
       FROM posts ${catScope.clause}
       GROUP BY category ORDER BY count DESC`
    )
    .all(...catScope.params) as TagCategoryItem[]

  const sceneScope = buildTagWhere(filters, ['scenes'])
  const sceneWhere = sceneScope.clause
    ? `${sceneScope.clause} AND analysis_scene IS NOT NULL AND analysis_scene != ''`
    : `WHERE analysis_scene IS NOT NULL AND analysis_scene != ''`
  const scenes = database
    .prepare(
      `SELECT analysis_scene as scene, COUNT(*) as count FROM posts ${sceneWhere}
       GROUP BY analysis_scene ORDER BY count DESC`
    )
    .all(...sceneScope.params) as TagFilterFacets['scenes']

  const statusScope = buildTagWhere(filters, ['status'])
  const statusRow = database
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN ${TAG_STATUS_SQL.untagged} THEN 1 ELSE 0 END) as untagged,
         SUM(CASE WHEN ${TAG_STATUS_SQL.tagged} THEN 1 ELSE 0 END) as tagged,
         SUM(CASE WHEN ${TAG_STATUS_SQL.ai} THEN 1 ELSE 0 END) as ai,
         SUM(CASE WHEN ${TAG_STATUS_SQL.manual} THEN 1 ELSE 0 END) as manual,
         SUM(CASE WHEN ${TAG_STATUS_SQL.both} THEN 1 ELSE 0 END) as both
       FROM posts ${statusScope.clause}`
    )
    .get(...statusScope.params) as { total: number } & Record<
    Exclude<TagStatusFilter, 'all'>,
    number
  >

  return {
    users,
    tags,
    categories,
    scenes,
    statusCounts: {
      untagged: statusRow.untagged || 0,
      tagged: statusRow.tagged || 0,
      ai: statusRow.ai || 0,
      manual: statusRow.manual || 0,
      both: statusRow.both || 0
    },
    total: statusRow.total || 0
  }
}
