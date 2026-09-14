/** 文件大小：1.5 MB / 12 KB / 0 B */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

/** 万以上用 w 缩写：12345 -> 1.2w */
export function formatCompactNumber(num: number): string {
  if (num >= 10000) return (num / 10000).toFixed(1) + 'w'
  return String(num)
}

/** 抖音作品 create_time（形如 2024-01-02 03:04:05 / 20240102 等）统一成 yyyy-MM-dd */
export function formatPostDate(dateStr: string): string {
  if (!dateStr) return ''
  const cleaned = dateStr.replace(/[-:T]/g, '').substring(0, 8)
  if (cleaned.length === 8) {
    return `${cleaned.substring(0, 4)}-${cleaned.substring(4, 6)}-${cleaned.substring(6, 8)}`
  }
  return dateStr
}

export interface DateTimeFormatOptions {
  /** 是否带年份 */
  year?: boolean
  /** 是否带秒 */
  seconds?: boolean
}

/** 秒级 Unix 时间戳 -> 本地「MM-dd HH:mm」（可选年 / 秒） */
export function formatUnixTime(
  ts: number | null | undefined,
  opts: DateTimeFormatOptions = {}
): string {
  if (!ts) return '-'
  return formatMillisTime(ts * 1000, opts)
}

/** 毫秒时间戳 -> 本地「MM-dd HH:mm」（可选年 / 秒） */
export function formatMillisTime(ms: number, opts: DateTimeFormatOptions = {}): string {
  return new Date(ms).toLocaleString('zh-CN', {
    ...(opts.year ? { year: 'numeric' } : {}),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(opts.seconds ? { second: '2-digit' } : {})
  })
}

/** 毫秒时间戳 -> HH:mm:ss（日志行用） */
export function formatClock(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 两个秒级时间戳之间的时长：1h2m / 3m4s / 5s；end 为空表示仍在进行 */
export function formatDuration(start: number, end: number | null): string {
  if (!end) return '进行中'
  const sec = Math.max(0, end - start)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}
