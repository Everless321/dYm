import { getPostObjects, type PostObjectRow } from '../../database'
import type { MediaFiles } from '../media'
import { loadStorageConfig } from './config'
import { remoteObjectUrl } from './client'

/** 旧命名的目录是 {date}_{nick}_{awemeId}，新命名就是 awemeId */
function awemeIdOf(folderName: string): string | null {
  return /(\d{8,})$/.exec(folderName)?.[1] ?? null
}

function cloudObjects(folderName: string): {
  rows: PostObjectRow[]
  url: (key: string) => string
} | null {
  const config = loadStorageConfig()
  const awemeId = awemeIdOf(folderName)
  if (!config || !awemeId) return null
  let rows: PostObjectRow[]
  try {
    rows = getPostObjects(awemeId)
  } catch (error) {
    console.warn('[Storage] 读取 post_objects 失败:', (error as Error).message)
    return null
  }
  if (rows.length === 0) return null
  return { rows, url: (key) => remoteObjectUrl(config, key) }
}

/**
 * 本地目录不在时，按 post_objects 拼出与 findMediaFiles 同形状的结果，只是路径换成 https 地址。
 * 渲染层用 toMediaSrc 区分：https 直接用，本地路径才加 local://file 前缀。
 */
export function findCloudMediaFiles(folderName: string, awemeType: number): MediaFiles | null {
  const found = cloudObjects(folderName)
  if (!found) return null
  const { rows, url } = found
  const one = (kind: PostObjectRow['kind']): string | undefined => {
    const row = rows.find((r) => r.kind === kind)
    return row ? url(row.key) : undefined
  }
  const cover = one('cover')

  if (awemeType === 68) {
    const images = rows.filter((r) => r.kind === 'image').sort((a, b) => a.idx - b.idx)
    const lives = new Map(rows.filter((r) => r.kind === 'live').map((r) => [r.idx, r.key]))
    return {
      type: 'images',
      images: images.map((r) => url(r.key)),
      imageVideos: images.map((r) => {
        const key = lives.get(r.idx)
        return key ? url(key) : null
      }),
      cover,
      music: one('music')
    }
  }
  return { type: 'video', video: one('video'), cover }
}

export function findCloudCover(folderName: string): string | null {
  const found = cloudObjects(folderName)
  const row = found?.rows.find((r) => r.kind === 'cover')
  return found && row ? found.url(row.key) : null
}
