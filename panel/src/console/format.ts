import type { LiveDownload, MediaRef, PanelTask } from './types'

export function formatCount(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString('zh-CN')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatExact(value: number | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function toMillis(value: number): number {
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function formatUnixAgo(value: number | null | undefined): string {
  if (!value) return ''
  return formatAgo(toMillis(value))
}

export function formatUnixExact(value: number | null | undefined): string {
  if (!value) return ''
  return formatExact(toMillis(value))
}

export function formatAgo(value: number | null | undefined): string {
  if (!value) return '尚未连接'
  const delta = Date.now() - value
  if (delta < 15_000) return '刚刚'
  if (delta < 60_000) return `${Math.floor(delta / 1000)} 秒前`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`
  return formatExact(value)
}

export function platformText(value: string | null | undefined): string {
  if (value === 'darwin') return 'macOS'
  if (value === 'win32') return 'Windows'
  if (value === 'linux') return 'Linux'
  return value || ''
}

export function tone(seed: string): number {
  let n = 0
  const text = String(seed || '')
  for (let i = 0; i < text.length; i += 1) n = (n * 31 + text.charCodeAt(i)) >>> 0
  return (n % 6) + 1
}

export function initials(name: string | null | undefined): string {
  const text = String(name || '').trim()
  return text ? text.slice(0, 1).toUpperCase() : '·'
}

export function mediaUrl(nodeId: string, ref: MediaRef | null | undefined): string {
  if (!ref) return ''
  if (ref.kind === 'remote' && /^https:\/\//.test(ref.url || '')) return ref.url || ''
  if (ref.kind === 'file' && ref.token) {
    return `/api/nodes/${encodeURIComponent(nodeId)}/media?token=${encodeURIComponent(ref.token)}`
  }
  return ''
}

export function taskProgress(task: PanelTask, live?: LiveDownload): string {
  if (live?.message) return live.message
  if (live?.status) return live.status
  if (task.progress?.message) return task.progress.message
  return `${formatCount(task.downloadedVideos)} / ${formatCount(task.totalVideos)}`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败'
}

export function readRoute(
  hash: string
): { name: 'list' } | { name: 'node'; id: string; tab: 'posts' | 'users' | 'tasks' } {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean)
  if (parts[0] === 'n' && parts[1]) {
    const tab = parts[2] === 'users' || parts[2] === 'tasks' ? parts[2] : 'posts'
    return { name: 'node', id: decodeURIComponent(parts[1]), tab }
  }
  return { name: 'list' }
}
