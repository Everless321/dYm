export type KuaishouParsedInput =
  | { kind: 'user'; userId: string }
  | { kind: 'work'; photoId: string; web: boolean; userId: string }
  | { kind: 'short'; url: string }
  | { kind: 'unknown' }

const ID = /^[A-Za-z0-9_-]{3,64}$/

/**
 * 链接形态对齐 KS-Downloader 的 Examiner：
 * 短链 v.kuaishou.com、/f/ 需要先跳转；主页 /profile/；作品 /short-video/ 与 /fw/photo/。
 */
export function parseKuaishouInput(input: string): KuaishouParsedInput {
  const text = input.trim()
  if (!text) return { kind: 'unknown' }
  if (/^https?:\/\/(?:v\.kuaishou\.(?:com|cn)|[^/\s]*kuaishou\.(?:com|cn)\/f)\//i.test(text)) {
    return { kind: 'short', url: text }
  }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { kind: 'unknown' }
  }
  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)

  if (
    (host === 'www.kuaishou.com' || host === 'live.kuaishou.com') &&
    segments[0] === 'profile' &&
    isId(segments[1])
  ) {
    return { kind: 'user', userId: segments[1] }
  }

  if (host.endsWith('chenzhongtech.com')) {
    const photoId = url.searchParams.get('photoId') || ''
    const userId = url.searchParams.get('userId') || ''
    if (isId(photoId)) return { kind: 'work', photoId, web: false, userId }
  }

  const photoId = segments.at(-1) || ''
  const isWork =
    segments.includes('short-video') || (segments.includes('fw') && segments.includes('photo'))
  if (isWork && isId(photoId) && /kuaishou\.(?:com|cn)$/i.test(host)) {
    return { kind: 'work', photoId, web: true, userId: '' }
  }
  return { kind: 'unknown' }
}

function isId(value: string | undefined): value is string {
  return Boolean(value && ID.test(value))
}
