/** 标签工作台的筛选条件全部存在 URL query 里，此处是唯一的读写约定。 */

/**
 * 「从工作台列表进来的」标记。无筛选条件时 query 是空串，
 * 光看 query 分不出「没有筛选」和「不是从列表进来的」，
 * 于是补一个占位参数。parseTagFilters 不认识它，不影响筛选结果。
 */
export const FROM_LIST = 'from=list'

/**
 * 去掉只用于导航的标记，得到可以写回工作台 URL 的 query。
 * 工作台的列表位置缓存以 query 为 key，标记漏回去就会认不出原来的位置。
 */
export function stripNavMarkers(search: string): string {
  const params = new URLSearchParams(search)
  params.delete('from')
  return params.toString()
}

/** URL 里的逗号分隔多值参数 */
export function readList(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key)
  return raw ? raw.split(',').filter(Boolean) : []
}

function readNumber(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key)
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export function parseTagFilters(params: URLSearchParams): TagPostFilters {
  const tags = readList(params, 'tags')
  const categories = readList(params, 'cat')
  const scenes = readList(params, 'scene')
  return {
    secUid: params.get('user') || undefined,
    tags: tags.length ? tags : undefined,
    tagMode: params.get('tagMode') === 'all' ? 'all' : 'any',
    status: (params.get('status') as TagStatusFilter | null) || 'all',
    categories: categories.length ? categories : undefined,
    scenes: scenes.length ? scenes : undefined,
    minLevel: readNumber(params, 'minLevel'),
    maxLevel: readNumber(params, 'maxLevel'),
    keyword: params.get('q') || undefined,
    sort: (params.get('sort') as TagPostSort | null) || 'downloaded'
  }
}

/** 有效筛选条件个数，用于「重置（N）」和空结果提示 */
export function countActiveFilters(f: TagPostFilters): number {
  return (
    (f.secUid ? 1 : 0) +
    (f.status && f.status !== 'all' ? 1 : 0) +
    (f.tags?.length || 0) +
    (f.categories?.length || 0) +
    (f.scenes?.length || 0) +
    (f.minLevel !== undefined || f.maxLevel !== undefined ? 1 : 0) +
    (f.keyword ? 1 : 0)
  )
}
