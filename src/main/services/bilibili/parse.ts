export type BilibiliParsedInput =
  | { kind: 'user'; mid: number }
  | { kind: 'video'; bvid?: string; aid?: number; page: number }
  | { kind: 'unknown' }

/**
 * 解析 B 站空间、视频、BV/AV、uid。短链 b23.tv 需要先跟随跳转再解析。
 * 路径规则来自 downkyicore `ParseEntrance.UserSpace` / `ParseEntrance.Video`。
 */
export function parseBilibiliInput(input: string): BilibiliParsedInput {
  const text = input.trim()
  if (!text) return { kind: 'unknown' }

  const uid = text.match(/^uid:?(\d+)$/i)
  if (uid) {
    const mid = Number(uid[1])
    return mid > 0 ? { kind: 'user', mid } : { kind: 'unknown' }
  }

  const bareBv = text.match(/^BV[0-9A-Za-z]{10}$/)
  if (bareBv) return { kind: 'video', bvid: bareBv[0], page: 1 }
  const bareAv = text.match(/^av(\d+)$/i)
  if (bareAv) return { kind: 'video', aid: Number(bareAv[1]), page: 1 }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    const embeddedBv = text.match(/BV[0-9A-Za-z]{10}/)
    if (embeddedBv) return { kind: 'video', bvid: embeddedBv[0], page: 1 }
    return { kind: 'unknown' }
  }

  const host = url.hostname.toLowerCase()
  const mid = userMidFromPath(host, url.pathname)
  if (mid > 0) return { kind: 'user', mid }

  const bv = url.pathname.match(/BV[0-9A-Za-z]{10}/)
  if (bv) return { kind: 'video', bvid: bv[0], page: pageOf(url) }
  const av = url.pathname.match(/\/av(\d+)/i) ?? url.pathname.match(/av(\d+)/i)
  if (av) return { kind: 'video', aid: Number(av[1]), page: pageOf(url) }
  return { kind: 'unknown' }
}

function userMidFromPath(host: string, pathname: string): number {
  const segments = pathname.split('/').filter(Boolean)
  if (host === 'space.bilibili.com') {
    const supported =
      segments.length === 1 ||
      (segments.length === 3 && segments[1] === 'upload' && segments[2] === 'video')
    if (!supported) return 0
    return positiveInt(segments[0])
  }
  if (host === 'm.bilibili.com' && segments[0] === 'space') return positiveInt(segments[1])
  return 0
}

function positiveInt(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 0
  const mid = Number(value)
  return mid > 0 ? mid : 0
}

function pageOf(url: URL): number {
  const page = Number(url.searchParams.get('p') || '1')
  return Number.isInteger(page) && page > 0 ? page : 1
}
