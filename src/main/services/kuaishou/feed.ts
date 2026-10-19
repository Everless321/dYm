export interface KuaishouWork {
  photoId: string
  caption: string
  coverUrl: string
  downloadUrls: string[]
  musicUrl: string
  timestampMs: number
  photoType: 'video' | 'images'
  authorId: string
  authorName: string
  avatarUrl: string
  likeCount: number
  viewCount: number
  fanCount: number
  followCount: number
  photoCount: number
}

export interface KuaishouFeedPage {
  works: KuaishouWork[]
  cursor: string
  finished: boolean
}

/** 把 profile/feed 的一条 feeds 收成作品。字段位置对齐 KS-Downloader 的 APIExtractor。 */
export function workFromFeedItem(input: unknown): KuaishouWork | null {
  const item = asRecord(input)
  if (!item) return null
  const photo = asRecord(item.photo) ?? item
  const photoId = photoIdOf(photo)
  if (!photoId) return null
  const photoType = classify(text(photo.photoType))
  const atlas = atlasUrls(item, photo)
  const videoUrl = text(item.mp4Url) || text(photo.photoUrl) || firstUrl(photo.mainMvUrls)
  const downloadUrls = photoType === 'images' ? atlas : videoUrl ? [videoUrl] : atlas
  const counts = asRecord(item.counts)
  return {
    photoId,
    caption: text(photo.caption),
    coverUrl: firstUrl(photo.coverUrls) || firstUrl(photo.webpCoverUrls),
    downloadUrls,
    musicUrl: musicUrlOf(photo, photoType),
    timestampMs: number(photo.timestamp),
    photoType: downloadUrls.length > 1 || photoType === 'images' ? 'images' : 'video',
    authorId: text(photo.userEid) || text(photo.userId),
    authorName: text(photo.userName),
    avatarUrl: firstUrl(photo.headUrls),
    likeCount: number(photo.likeCount),
    viewCount: number(photo.viewCount),
    fanCount: number(counts?.fanCount),
    followCount: number(counts?.followCount),
    photoCount: number(counts?.photoCount)
  }
}

export function pageFromFeed(payload: unknown): KuaishouFeedPage {
  const body = asRecord(payload) ?? {}
  const feeds = Array.isArray(body.feeds) ? body.feeds : []
  const works = feeds.map(workFromFeedItem).filter((work): work is KuaishouWork => work !== null)
  const cursor = text(body.pcursor)
  const finished = !cursor || cursor === 'no_more' || works.length === 0
  return { works, cursor, finished }
}

function photoIdOf(photo: Record<string, unknown>): string {
  const direct = text(photo.photoId) || text(photo.id)
  if (direct) return direct
  const share = text(photo.share_info)
  const matched = share.match(/(?:^|[?&])photoId=([^&]+)/)
  return matched?.[1] ? decodeURIComponent(matched[1]) : ''
}

function classify(photoType: string): 'video' | 'images' {
  return photoType.includes('ATLAS') ? 'images' : 'video'
}

function atlasUrls(item: Record<string, unknown>, photo: Record<string, unknown>): string[] {
  const atlas = asRecord(item.atlas) ?? asRecord(asRecord(photo.ext_params)?.atlas)
  if (!atlas) return []
  const cdnList = Array.isArray(atlas.cdn) ? atlas.cdn : []
  const cdn = typeof cdnList[0] === 'string' ? cdnList[0] : ''
  const list = Array.isArray(atlas.list) ? atlas.list : []
  if (!cdn) return []
  return list
    .filter((entry): entry is string => typeof entry === 'string')
    .map((path) => `https://${cdn}${path}`)
}

function musicUrlOf(photo: Record<string, unknown>, photoType: 'video' | 'images'): string {
  const music = asRecord(photoType === 'video' ? photo.soundTrack : photo.music)
  return firstUrl(music?.audioUrls)
}

function firstUrl(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return ''
  const first = value[0]
  if (typeof first === 'string') return first
  return text(asRecord(first)?.url)
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
