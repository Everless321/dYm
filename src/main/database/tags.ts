import { getDatabase } from './connection'
import { getSetting, setSetting } from './settings'
import type { DbPost } from './posts'

export function parseTagJSON(s: string | null): string[] {
  if (!s) return []
  try {
    const arr = JSON.parse(s)
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

// 合并某 post 的 AI 标签与手动标签，去重保序
function mergedTagsOf(post: {
  analysis_tags: string | null
  manual_tags: string | null
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [...parseTagJSON(post.analysis_tags), ...parseTagJSON(post.manual_tags)]) {
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

export function getAllTags(): string[] {
  const database = getDatabase()

  // 可见用户的帖子中的所有标签。子查询代替展开 IN (?,?,…)，可见用户上千时会顶变量上限
  const rows = database
    .prepare(
      `SELECT analysis_tags, manual_tags FROM posts
       WHERE sec_uid IN (SELECT sec_uid FROM users WHERE show_in_home = 1)
         AND (analysis_tags IS NOT NULL OR manual_tags IS NOT NULL)`
    )
    .all() as { analysis_tags: string | null; manual_tags: string | null }[]

  const tagSet = new Set<string>()
  for (const row of rows) {
    mergedTagsOf(row).forEach((tag) => tagSet.add(tag))
  }

  return Array.from(tagSet).sort()
}

// ==================== 标签管理 ====================

// 写入单个 post 的标签（按需更新 AI / 手动来源）。不改 analyzed_at。
export function setPostTags(id: number, input: { aiTags?: string[]; manualTags?: string[] }): void {
  const database = getDatabase()
  const fields: string[] = []
  const values: unknown[] = []
  if (input.aiTags !== undefined) {
    fields.push('analysis_tags = ?')
    values.push(input.aiTags.length ? JSON.stringify(input.aiTags) : null)
  }
  if (input.manualTags !== undefined) {
    fields.push('manual_tags = ?')
    values.push(input.manualTags.length ? JSON.stringify(input.manualTags) : null)
  }
  if (!fields.length) return
  values.push(id)
  database.prepare(`UPDATE posts SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export type ClearTagScope = 'all' | 'ai' | 'manual'

// 批量清除标签。清 AI 时连带重置分析字段与 analyzed_at（回到未分析，便于重标队列捡到）。
export function clearTags(postIds: number[], scope: ClearTagScope): number {
  if (!postIds.length) return 0
  const database = getDatabase()
  const placeholders = postIds.map(() => '?').join(',')
  const tx = database.transaction((ids: number[]) => {
    if (scope === 'manual' || scope === 'all') {
      database
        .prepare(`UPDATE posts SET manual_tags = NULL WHERE id IN (${placeholders})`)
        .run(...ids)
    }
    if (scope === 'ai' || scope === 'all') {
      database
        .prepare(
          `UPDATE posts SET analysis_tags = NULL, analysis_category = NULL, analysis_summary = NULL,
             analysis_scene = NULL, analysis_content_level = NULL, analyzed_at = NULL
           WHERE id IN (${placeholders})`
        )
        .run(...ids)
    }
  })
  tx(postIds)
  return postIds.length
}

// 按映射跨 analysis_tags + manual_tags 改写标签（parse→映射→去重→写回，整体事务）
// value 为 null 表示删除该标签
function rewriteTagsWithMapping(mapping: Map<string, string | null>): number {
  const sources = Array.from(mapping.keys())
  if (!sources.length) return 0
  const database = getDatabase()
  const likeClause = sources.map(() => '(analysis_tags LIKE ? OR manual_tags LIKE ?)').join(' OR ')
  const params: unknown[] = []
  sources.forEach((s) => params.push(`%"${s}"%`, `%"${s}"%`))
  const rows = database
    .prepare(`SELECT id, analysis_tags, manual_tags FROM posts WHERE ${likeClause}`)
    .all(...params) as { id: number; analysis_tags: string | null; manual_tags: string | null }[]

  const apply = (tags: string[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const t of tags) {
      if (mapping.get(t) === null) continue // 映射为 null 表示删除
      const mapped = mapping.get(t) ?? t
      if (!seen.has(mapped)) {
        seen.add(mapped)
        out.push(mapped)
      }
    }
    return out
  }

  const update = database.prepare(
    'UPDATE posts SET analysis_tags = ?, manual_tags = ? WHERE id = ?'
  )
  const tx = database.transaction((items: typeof rows) => {
    for (const row of items) {
      const ai = apply(parseTagJSON(row.analysis_tags))
      const manual = apply(parseTagJSON(row.manual_tags))
      update.run(
        ai.length ? JSON.stringify(ai) : null,
        manual.length ? JSON.stringify(manual) : null,
        row.id
      )
    }
  })
  tx(rows)
  return rows.length
}

export function renameTag(oldName: string, newName: string): number {
  if (!oldName || !newName || oldName === newName) return 0
  return rewriteTagsWithMapping(new Map([[oldName, newName]]))
}

export function mergeTags(names: string[], into: string): number {
  const mapping = new Map<string, string>()
  for (const n of names) {
    if (n && n !== into) mapping.set(n, into)
  }
  return rewriteTagsWithMapping(mapping)
}

// 删除标签：从所有视频的 AI/手动标签中移除，同时从自定义标签库剔除
export function deleteTags(names: string[]): number {
  const targets = names.filter(Boolean)
  if (!targets.length) return 0
  const mapping = new Map<string, string | null>(targets.map((n) => [n, null]))
  const affected = rewriteTagsWithMapping(mapping)
  const set = new Set(targets)
  const cur = getCustomTags()
  const next = cur.filter((t) => !set.has(t))
  if (next.length !== cur.length) setSetting('tag_library_custom', JSON.stringify(next))
  return affected
}

// 自定义标签库（无独立 tags 表，存设置项）。承载"新建"与"未使用"标签来源。
export function getCustomTags(): string[] {
  return parseTagJSON(getSetting('tag_library_custom'))
}

export function addCustomTag(name: string): void {
  const t = name.trim()
  if (!t) return
  const cur = getCustomTags()
  if (!cur.includes(t)) setSetting('tag_library_custom', JSON.stringify([...cur, t]))
}

export function removeCustomTag(name: string): void {
  const cur = getCustomTags()
  setSetting('tag_library_custom', JSON.stringify(cur.filter((t) => t !== name)))
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
  const total = row?.total || 0
  const tagged = row?.tagged || 0
  return {
    totalVideos: total,
    tagged,
    untagged: total - tagged,
    tagKinds: getTagsWithFrequency().length
  }
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

// 单条聚合查询，避免每用户一次查询（几百用户时性能差）
export function getUserTagStats(): UserTagStats[] {
  const database = getDatabase()
  const rows = database
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

// 标签频率（每 post 内合并去重计 1 次）+ 来源标记。不受 show_in_home 限制。
// 传 secUid 则只统计该用户，用于用户内容画像。
export function getTagsWithFrequency(secUid?: string): TagFrequencyItem[] {
  const database = getDatabase()
  const rows = database
    .prepare(
      `SELECT analysis_tags, manual_tags, analysis_category FROM posts
       WHERE (analysis_tags IS NOT NULL OR manual_tags IS NOT NULL)${secUid ? ' AND sec_uid = ?' : ''}`
    )
    .all(...(secUid ? [secUid] : [])) as {
    analysis_tags: string | null
    manual_tags: string | null
    analysis_category: string | null
  }[]
  const map = new Map<string, { count: number; ai: boolean; manual: boolean; cats: Set<string> }>()
  for (const row of rows) {
    const aiSet = new Set(parseTagJSON(row.analysis_tags))
    const manualSet = new Set(parseTagJSON(row.manual_tags))
    const cat = row.analysis_category?.trim()
    for (const t of new Set([...aiSet, ...manualSet])) {
      const e = map.get(t) || { count: 0, ai: false, manual: false, cats: new Set<string>() }
      e.count++
      if (aiSet.has(t)) e.ai = true
      if (manualSet.has(t)) e.manual = true
      if (cat) e.cats.add(cat)
      map.set(t, e)
    }
  }
  return Array.from(map.entries())
    .map(
      ([tag, e]): TagFrequencyItem => ({
        tag,
        count: e.count,
        source: e.ai && e.manual ? 'both' : e.ai ? 'ai' : 'manual',
        categories: Array.from(e.cats)
      })
    )
    .sort((a, b) => b.count - a.count)
}

export interface TagLibraryStats {
  totalTags: number
  categories: number
  usedTags: number
  unusedTags: number
}

export function getTagLibraryStats(): TagLibraryStats {
  const database = getDatabase()
  const freq = getTagsWithFrequency()
  const usedSet = new Set(freq.map((t) => t.tag))
  const unused = getCustomTags().filter((t) => !usedSet.has(t))
  const catRow = database
    .prepare(
      `SELECT COUNT(DISTINCT analysis_category) as c FROM posts WHERE analysis_category IS NOT NULL AND analysis_category != ''`
    )
    .get() as { c: number }
  return {
    totalTags: usedSet.size + unused.length,
    categories: catRow?.c || 0,
    usedTags: usedSet.size,
    unusedTags: unused.length
  }
}

export interface TagCategoryItem {
  category: string
  count: number
}

export function getTagCategories(): TagCategoryItem[] {
  const database = getDatabase()
  return database
    .prepare(
      `SELECT COALESCE(NULLIF(analysis_category, ''), '未分类') as category, COUNT(*) as count
       FROM posts WHERE analysis_tags IS NOT NULL OR manual_tags IS NOT NULL
       GROUP BY category ORDER BY count DESC`
    )
    .all() as TagCategoryItem[]
}

/** 标注状态：按 analysis_tags / manual_tags 的有无组合 */
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

/** 可从 WHERE 中排除的筛选维度，用于分面计数（统计某维度时不能被它自己约束） */
type TagFilterDimension = 'user' | 'tags' | 'status' | 'categories' | 'scenes' | 'level'

// 把筛选条件编译成 WHERE 子句。omit 里的维度会被跳过。
function buildTagWhere(
  filters: TagPostFilters | undefined,
  omit: TagFilterDimension[] = []
): { clause: string; params: unknown[] } {
  const skip = new Set(omit)
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.secUid && !skip.has('user')) {
    conditions.push('sec_uid = ?')
    params.push(filters.secUid)
  }

  if (filters?.tags?.length && !skip.has('tags')) {
    // 每个标签一个「AI 或手动命中」子条件，再按 tagMode 用 AND / OR 串起来
    const joiner = filters.tagMode === 'all' ? ' AND ' : ' OR '
    const tagConditions = filters.tags
      .map(() => '(analysis_tags LIKE ? OR manual_tags LIKE ?)')
      .join(joiner)
    conditions.push(`(${tagConditions})`)
    filters.tags.forEach((tag) => params.push(`%"${tag}"%`, `%"${tag}"%`))
  }

  if (filters?.status && filters.status !== 'all' && !skip.has('status')) {
    conditions.push(`(${TAG_STATUS_SQL[filters.status]})`)
  }

  if (filters?.categories?.length && !skip.has('categories')) {
    // '未分类' 代表 analysis_category 为空
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
    conditions.push('(caption LIKE ? OR desc LIKE ? OR analysis_tags LIKE ? OR manual_tags LIKE ?)')
    const kw = `%${filters.keyword.trim()}%`
    params.push(kw, kw, kw, kw)
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

/**
 * 同筛选条件下的全部作品 id，顺序与 queryPostsForTags 一致。
 * 详情页的上/下一条队列用它 —— 只取 id 是因为整行有 desc/summary 等长文本，
 * 全库上万条时按行拉会有几 MB 走 IPC。
 */
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
  /** 「全部状态」那一行的计数 */
  total: number
}

// 筛选栏的可选项 + 计数，一次 IPC 查完。
// 每个维度的计数都排除自身条件（标准分面语义），否则选中一项后其他项会全变 0。
export function getTagFilterFacets(filters?: TagPostFilters): TagFilterFacets {
  const database = getDatabase()

  const userScope = buildTagWhere(filters, ['user'])
  const users = database
    .prepare(
      `SELECT p.sec_uid, COALESCE(u.nickname, p.nickname) as nickname, COUNT(*) as count
       FROM posts p LEFT JOIN users u ON u.sec_uid = p.sec_uid
       ${userScope.clause}
       GROUP BY p.sec_uid ORDER BY count DESC`
    )
    .all(...userScope.params) as TagFilterFacets['users']

  const tagScope = buildTagWhere(filters, ['tags'])
  const tagRows = database
    .prepare(`SELECT analysis_tags, manual_tags FROM posts ${tagScope.clause}`)
    .all(...tagScope.params) as { analysis_tags: string | null; manual_tags: string | null }[]
  const tagCount = new Map<string, number>()
  for (const row of tagRows) {
    // 同一 post 内 AI + 手动重复的标签只计 1 次
    for (const t of new Set([
      ...parseTagJSON(row.analysis_tags),
      ...parseTagJSON(row.manual_tags)
    ])) {
      tagCount.set(t, (tagCount.get(t) || 0) + 1)
    }
  }
  const tags = Array.from(tagCount, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count
  )

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

// 批量给视频追加手动标签（与已有 manual_tags 合并去重，不动 AI 标签）
export function addTagsToPosts(postIds: number[], tags: string[]): number {
  const clean = tags.map((t) => t.trim()).filter(Boolean)
  if (!postIds.length || !clean.length) return 0
  const database = getDatabase()
  const placeholders = postIds.map(() => '?').join(',')
  const rows = database
    .prepare(`SELECT id, manual_tags FROM posts WHERE id IN (${placeholders})`)
    .all(...postIds) as { id: number; manual_tags: string | null }[]
  const update = database.prepare(`UPDATE posts SET manual_tags = ? WHERE id = ?`)
  const tx = database.transaction(() => {
    for (const row of rows) {
      const merged = Array.from(new Set([...parseTagJSON(row.manual_tags), ...clean]))
      update.run(JSON.stringify(merged), row.id)
    }
  })
  tx()
  return rows.length
}
