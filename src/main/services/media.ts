import { app } from 'electron'
import { existsSync, readdirSync } from 'fs'
import { join, normalize, resolve, sep } from 'path'
import { getSetting } from '../database'

export interface MediaFiles {
  type: 'video' | 'images'
  video?: string
  images?: string[]
  imageVideos?: (string | null)[]
  cover?: string
  music?: string
}

export function getDownloadPath(): string {
  const customPath = getSetting('download_path')
  if (customPath && customPath.trim()) {
    return customPath
  }
  return join(app.getPath('userData'), 'Download', 'post')
}

export function toUrlPath(filePath: string): string {
  if (process.platform === 'win32') {
    return '/' + filePath.replace(/\\/g, '/')
  }
  return filePath
}

export function fromUrlPath(filePath: string): string {
  if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
    return normalize(filePath.slice(1))
  }
  return normalize(filePath)
}

export function isPathInDownloadRoot(filePath: string): boolean {
  const downloadRoot = resolve(fromUrlPath(getDownloadPath()))
  const resolvedPath = resolve(fromUrlPath(filePath))
  return resolvedPath === downloadRoot || resolvedPath.startsWith(downloadRoot + sep)
}

export function findMediaFiles(
  secUid: string,
  folderName: string,
  awemeType: number
): MediaFiles | null {
  const basePath = join(getDownloadPath(), secUid)
  if (!existsSync(basePath)) return null

  let targetFolder: string | null = null
  const exactPath = join(basePath, folderName)

  if (existsSync(exactPath)) {
    targetFolder = exactPath
  } else {
    try {
      const folders = readdirSync(basePath)
      for (const folder of folders) {
        if (folder.endsWith(folderName) || folder.includes(`_${folderName}`)) {
          targetFolder = join(basePath, folder)
          break
        }
      }
    } catch {
      return null
    }
  }

  if (!targetFolder) return null

  try {
    const files = readdirSync(targetFolder)
    const coverFile = files.find((f) => f.includes('_cover.'))
    const cover = coverFile ? toUrlPath(join(targetFolder, coverFile)) : undefined
    const musicFile = files.find((f) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f))
    const music = musicFile ? toUrlPath(join(targetFolder, musicFile)) : undefined

    if (awemeType === 68) {
      const imageFiles = files
        .filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f) && !f.includes('_cover'))
        .sort()
      const videoFiles = files.filter((f) => /\.mp4$/i.test(f)).sort()
      const stripExt = (f: string): string => f.replace(/\.[^.]+$/, '')
      const videoByBase = new Map<string, string>()
      for (const v of videoFiles) videoByBase.set(stripExt(v), v)

      const images = imageFiles.map((f) => toUrlPath(join(targetFolder, f)))
      let imageVideos: (string | null)[] = imageFiles.map((f) => {
        const match = videoByBase.get(stripExt(f))
        return match ? toUrlPath(join(targetFolder, match)) : null
      })
      // Fallback：basename 完全不匹配时，按顺序配对
      const matchedCount = imageVideos.filter((v) => v).length
      if (matchedCount === 0 && videoFiles.length === imageFiles.length) {
        imageVideos = videoFiles.map((v) => toUrlPath(join(targetFolder, v)))
      }
      return { type: 'images', images, imageVideos, cover, music }
    }

    const videoFile = files.find((f) => /\.(mp4|mov|avi)$/i.test(f))
    const video = videoFile ? toUrlPath(join(targetFolder, videoFile)) : undefined
    return { type: 'video', video, cover }
  } catch {
    return null
  }
}

export function findCoverFile(secUid: string, folderName: string): string | null {
  const basePath = join(getDownloadPath(), secUid)
  if (!existsSync(basePath)) return null

  const exactPath = join(basePath, folderName)
  if (existsSync(exactPath)) {
    try {
      const files = readdirSync(exactPath)
      const coverFile = files.find((f) => f.includes('_cover.'))
      if (coverFile) return toUrlPath(join(exactPath, coverFile))
    } catch {
      return null
    }
  }

  try {
    const folders = readdirSync(basePath)
    for (const folder of folders) {
      if (folder.endsWith(folderName) || folder.includes(`_${folderName}`)) {
        const folderPath = join(basePath, folder)
        const files = readdirSync(folderPath)
        const coverFile = files.find((f) => f.includes('_cover.'))
        if (coverFile) return toUrlPath(join(folderPath, coverFile))
      }
    }
  } catch {
    return null
  }

  return null
}
