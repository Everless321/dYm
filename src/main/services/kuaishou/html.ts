export interface KuaishouPageDetail {
  photoId: string
  caption: string
  coverUrl: string
  photoUrl: string
  authorId: string
  authorName: string
  timestampMs: number
  durationMs: number
  likeCount: number
  viewCount: number
}

const WEB_MARKER = 'window.__APOLLO_STATE__='
const APP_MARKER = 'window.INIT_STATE = '
const WEB_TAIL = ';(function(){var s;'

/**
 * 从作品页 HTML 取出 KS-Downloader HTMLExtractor 使用的同一段内嵌数据。
 * 网页是 Apollo state，移动端中转页是 INIT_STATE。
 */
export function extractKuaishouPageDetail(
  html: string,
  photoId: string,
  web: boolean
): KuaishouPageDetail | null {
  const payload = web ? readApollo(html) : readInitState(html)
  if (!payload) return null
  return web ? detailFromApollo(payload, photoId) : detailFromInit(payload, photoId)
}

function readApollo(html: string): Record<string, unknown> | null {
  const start = html.indexOf(WEB_MARKER)
  if (start < 0) return null
  let text = html.slice(start + WEB_MARKER.length)
  const tail = text.indexOf(WEB_TAIL)
  if (tail >= 0) text = text.slice(0, tail)
  return asRecord(parseJson(text.trim().replace(/;$/, '')))
}

function readInitState(html: string): Record<string, unknown> | null {
  const start = html.indexOf(APP_MARKER)
  if (start < 0) return null
  const text = html.slice(start + APP_MARKER.length)
  const json = readBalanced(text)
  return asRecord(parseJson(json))
}

function detailFromApollo(
  state: Record<string, unknown>,
  photoId: string
): KuaishouPageDetail | null {
  const client = asRecord(state.defaultClient) ?? state
  const photo = asRecord(client[`VisionVideoDetailPhoto:${photoId}`])
  if (!photo) return null
  const authorEntry = Object.entries(client).find(([key]) =>
    key.startsWith('VisionVideoDetailAuthor:')
  )
  const author = asRecord(authorEntry?.[1])
  return {
    photoId,
    caption: text(photo.caption),
    coverUrl: text(photo.coverUrl),
    photoUrl: text(photo.photoUrl),
    authorId: text(author?.id),
    authorName: text(author?.name),
    timestampMs: number(photo.timestamp),
    durationMs: number(photo.duration),
    likeCount: number(photo.realLikeCount),
    viewCount: number(photo.viewCount)
  }
}

function detailFromInit(
  state: Record<string, unknown>,
  photoId: string
): KuaishouPageDetail | null {
  const photo = asRecord(state.photo)
  if (!photo) return null
  const id = text(photo.photoId) || text(photo.id) || photoId
  return {
    photoId: id,
    caption: text(photo.caption),
    coverUrl: firstUrl(photo.coverUrls) || text(photo.coverUrl),
    photoUrl: text(photo.photoUrl) || firstUrl(photo.mainMvUrls),
    authorId: text(photo.userEid) || text(photo.userId),
    authorName: text(photo.userName),
    timestampMs: number(photo.timestamp),
    durationMs: number(photo.duration),
    likeCount: number(photo.likeCount),
    viewCount: number(photo.viewCount)
  }
}

function firstUrl(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return ''
  const first = value[0]
  if (typeof first === 'string') return first
  return text(asRecord(first)?.url)
}

function readBalanced(text: string): string {
  const start = text.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  let quote = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quote = false
      continue
    }
    if (char === '"') quote = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return ''
}

function parseJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
