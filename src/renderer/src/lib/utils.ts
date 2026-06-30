import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 头像地址：优先用本地保存的文件（local:// 协议，稳定不失效），
 * 否则回退到抖音远程链接（可能因防盗链/过期加载失败）。
 */
export function getAvatarUrl(user: { avatar?: string; avatar_path?: string }): string | undefined {
  if (user.avatar_path) return `local://${user.avatar_path}`
  return user.avatar || undefined
}

/** 解析标签 JSON 字符串，容错：失败返回 [] */
export function parseTags(s: string | null | undefined): string[] {
  if (!s) return []
  try {
    const arr = JSON.parse(s)
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/** 合并某 post 的 AI 标签与手动标签，去重保序 */
export function getMergedTags(post: {
  analysis_tags?: string | null
  manual_tags?: string | null
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [...parseTags(post.analysis_tags), ...parseTags(post.manual_tags)]) {
    if (!seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}
