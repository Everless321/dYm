/**
 * 本地作品目录 → 对象存储 key 的映射。
 *
 * 布局与 dym-cloud 的 scripts/import-legacy/upload.py 逐字节一致：
 *   creators/{secUid}/posts/{awemeId}/{cover.jpg | video.mp4 | images/{i}.jpg | live/{i}.mp4 | music.mp3}
 * 一致才能「认领」已经传上去的对象（HEAD 大小相同就跳过），不必重传。
 * 扩展名是固定的，真实格式靠 Content-Type 区分（封面可能是 webp，原声可能是 m4a）。
 */

export type ObjectKind = 'cover' | 'video' | 'image' | 'live' | 'music'

export interface PlannedObject {
  /** 作品目录内的文件名 */
  file: string
  key: string
  kind: ObjectKind
  /** 图片 / 实况的下标（从 0 开始），其余为 0 */
  idx: number
  contentType: string
}

const IMAGE_INDEX_RE = /_image_(\d+)\./
const LIVE_INDEX_RE = /_live_(\d+)\./
const MUSIC_RE = /_music\.(mp3|m4a|aac)$/i

export function postKeyPrefix(secUid: string, awemeId: string): string {
  return `creators/${secUid}/posts/${awemeId}/`
}

export function contentTypeFor(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  return 'application/octet-stream'
}

function indexOf(re: RegExp, name: string): number | null {
  const m = re.exec(name)
  return m ? Number(m[1]) : null
}

/**
 * 挑出要传的文件并算出 key，顺序固定为 封面、正片、图片、实况、原声。
 *
 * 正片只认 _video.mp4：_live_N.mp4 是图集实况，拿它充当正片会让前端把整组图片藏掉。
 * 图片和实况按 _{image,live}_{n} 的序号排（字典序会把 _10 排到 _2 前面）；
 * polydl 里两者取自同一个下标，所以 _live_N 就是第 N 张图的实况。
 */
export function planPostObjects(
  files: readonly string[],
  secUid: string,
  awemeId: string
): PlannedObject[] {
  const base = postKeyPrefix(secUid, awemeId)
  const entry = (file: string, key: string, kind: ObjectKind, idx = 0): PlannedObject => ({
    file,
    key: base + key,
    kind,
    idx,
    contentType: contentTypeFor(file)
  })

  const cover = files.find((f) => f.includes('_cover.'))
  const video = files.find((f) => f.endsWith('_video.mp4'))
  const music = files.find((f) => MUSIC_RE.test(f))
  const images = files
    .filter((f) => IMAGE_INDEX_RE.test(f))
    .map((f) => ({ f, n: indexOf(IMAGE_INDEX_RE, f)! }))
    .sort((a, b) => a.n - b.n)
    .map(({ f }) => f)
  const lives = new Map<number, string>()
  for (const f of files) {
    const n = indexOf(LIVE_INDEX_RE, f)
    if (n !== null) lives.set(n, f)
  }
  const slots = Math.max(images.length, ...lives.keys(), 0)

  return [
    ...(cover ? [entry(cover, 'cover.jpg', 'cover')] : []),
    ...(video ? [entry(video, 'video.mp4', 'video')] : []),
    ...images.map((f, i) => entry(f, `images/${i}.jpg`, 'image', i)),
    ...Array.from({ length: slots }, (_, i) => lives.get(i + 1))
      .map((f, i) => (f ? entry(f, `live/${i}.mp4`, 'live', i) : null))
      .filter((o): o is PlannedObject => o !== null),
    ...(music ? [entry(music, 'music.mp3', 'music')] : [])
  ]
}

const OBJECT_KEY_RE =
  /^creators\/[^/]+\/posts\/[^/]+\/(?:(cover)\.jpg|(video)\.mp4|(music)\.mp3|(images)\/(\d+)\.jpg|(live)\/(\d+)\.mp4)$/

/** planPostObjects 的逆运算：只在本地目录已不在、需要从桶里认领时用 */
export function parseObjectKey(key: string): { kind: ObjectKind; idx: number } | null {
  const m = OBJECT_KEY_RE.exec(key)
  if (!m) return null
  if (m[1]) return { kind: 'cover', idx: 0 }
  if (m[2]) return { kind: 'video', idx: 0 }
  if (m[3]) return { kind: 'music', idx: 0 }
  if (m[4]) return { kind: 'image', idx: Number(m[5]) }
  return { kind: 'live', idx: Number(m[7]) }
}

function extensionFor(kind: ObjectKind, contentType: string | null): string {
  if (kind === 'video' || kind === 'live') return 'mp4'
  if (kind === 'music') return contentType === 'audio/mp4' ? 'm4a' : 'mp3'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'image/png') return 'png'
  return 'jpg'
}

/**
 * 从桶里取回到缓存目录时用的文件名，沿用 polydl 的命名（{id}_image_{n} 从 1 开始），
 * 这样缓存目录可以原样交给只认本地目录的代码（AI 抽帧、图集读取）。
 */
export function localFileNameFor(
  awemeId: string,
  kind: ObjectKind,
  idx: number,
  contentType: string | null
): string {
  const ext = extensionFor(kind, contentType)
  if (kind === 'image') return `${awemeId}_image_${idx + 1}.${ext}`
  if (kind === 'live') return `${awemeId}_live_${idx + 1}.${ext}`
  return `${awemeId}_${kind}.${ext}`
}
