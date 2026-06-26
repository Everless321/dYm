export const DEFAULT_SORT: PostSortConfig = { field: 'create_time', order: 'DESC' }

export function getInitialSort(storageKey: string): PostSortConfig {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) return JSON.parse(saved) as PostSortConfig
  } catch {
    // 忽略解析错误
  }
  return DEFAULT_SORT
}
