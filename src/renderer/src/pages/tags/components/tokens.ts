// 标签管理模块统一色板 —— 集中此前散落在各页的硬编码颜色

/** 标签来源徽标配色 */
export const TAG_SOURCE = {
  ai: { color: '#0A84FF', bg: '#E8F0FE', label: 'AI' },
  manual: { color: '#34C759', bg: '#E8F8EE', label: '手动' },
  both: { color: '#AF52DE', bg: '#F3E8FB', label: '混合' }
} as const

export type TagSource = keyof typeof TAG_SOURCE

/** 统计 / 强调语义色 */
export const ACCENT = {
  neutral: '#1D1D1F',
  blue: '#0A84FF',
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
  purple: '#AF52DE'
} as const
