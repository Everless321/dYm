/**
 * 标签工作台左侧筛选栏的个人偏好：分组顺序 + 折叠状态。
 *
 * 这些是「看着顺手」的设置而非筛选条件，所以不进 URL（见 filters.ts），
 * 而是存本地 —— 页面会因为进详情页而卸载，光靠组件 state 留不住。
 */

const STORAGE_KEY = 'tag_filter_panel'

/** 默认顺序，也是 id 的唯一清单 */
export const FILTER_SECTION_IDS = ['status', 'user', 'tag', 'category', 'scene', 'level'] as const

export type FilterSectionId = (typeof FILTER_SECTION_IDS)[number]

/** 首次使用时默认折叠的分组，与改造前这三个分组的 defaultOpen={false} 保持一致 */
const DEFAULT_COLLAPSED: FilterSectionId[] = ['category', 'scene', 'level']

export interface PanelPrefs {
  order: FilterSectionId[]
  /** 折叠起来的分组。存「折叠的」而非「展开的」，新增分组时默认展开更自然 */
  collapsed: FilterSectionId[]
}

function isSectionId(value: unknown): value is FilterSectionId {
  return typeof value === 'string' && (FILTER_SECTION_IDS as readonly string[]).includes(value)
}

function defaults(): PanelPrefs {
  return { order: [...FILTER_SECTION_IDS], collapsed: [...DEFAULT_COLLAPSED] }
}

/**
 * 只保留认识的 id 并去重，再把存档里缺的补到末尾。
 * 以后增删分组时，旧存档不会让新分组消失、也不会留下已删除的分组。
 */
function sanitizeOrder(value: unknown): FilterSectionId[] {
  const stored = Array.isArray(value) ? value.filter(isSectionId) : []
  const kept = [...new Set(stored)]
  return [...kept, ...FILTER_SECTION_IDS.filter((id) => !kept.includes(id))]
}

export function readPanelPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults()
    const parsed = JSON.parse(raw)
    return {
      order: sanitizeOrder(parsed?.order),
      collapsed: Array.isArray(parsed?.collapsed)
        ? parsed.collapsed.filter(isSectionId)
        : [...DEFAULT_COLLAPSED]
    }
  } catch {
    // 存档损坏就退回默认值，不值得为此打扰用户
    return defaults()
  }
}

export function writePanelPrefs(prefs: PanelPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // 写不进去（配额满等）只影响下次打开的初始状态，当次使用不受影响
  }
}
