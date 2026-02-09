import type { FastifyInstance } from 'fastify'
import { join } from 'path'
import { existsSync, readdirSync, createReadStream, statSync } from 'fs'
import { getAllPosts, getAllTags, getSetting } from '../database/index.js'
import type { PostFilters } from '@dym/shared'

function getDownloadPath(): string {
  const customPath = getSetting('download_path')
  if (customPath && customPath.trim()) {
    return customPath
  }
  return join(process.env.DYM_DATA_DIR || join(process.cwd(), 'data'), 'Download', 'post')
}

function findCoverFile(secUid: string, folderName: string): string | null {
  const basePath = join(getDownloadPath(), secUid)
  if (!existsSync(basePath)) return null

  const exactPath = join(basePath, folderName)
  if (existsSync(exactPath)) {
    try {
      const files = readdirSync(exactPath)
      const coverFile = files.find((f) => f.includes('_cover.'))
      if (coverFile) return join(exactPath, coverFile)
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
        if (coverFile) return join(folderPath, coverFile)
      }
    }
  } catch {
    return null
  }

  return null
}

interface MediaFiles {
  type: 'video' | 'images'
  video?: string
  images?: string[]
  cover?: string
  music?: string
}

function findMediaFiles(secUid: string, folderName: string, awemeType: number): MediaFiles | null {
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
    const cover = coverFile ? `/media/${secUid}/${folderName}/${coverFile}` : undefined

    const musicFile = files.find((f) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f))
    const music = musicFile ? `/media/${secUid}/${folderName}/${musicFile}` : undefined

    if (awemeType === 68) {
      const images = files
        .filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f) && !f.includes('_cover'))
        .map((f) => `/media/${secUid}/${folderName}/${f}`)
        .sort()
      return { type: 'images', images, cover, music }
    }

    const videoFile = files.find((f) => /\.(mp4|mov|avi)$/i.test(f))
    const video = videoFile ? `/media/${secUid}/${folderName}/${videoFile}` : undefined
    return { type: 'video', video, cover }
  } catch {
    return null
  }
}

export function registerPostRoutes(server: FastifyInstance): void {
  server.get<{ Querystring: { page?: string; pageSize?: string; filters?: string } }>(
    '/api/posts',
    async (request) => {
      try {
        const page = parseInt(request.query.page || '1')
        const pageSize = parseInt(request.query.pageSize || '20')
        let filters: PostFilters | undefined
        if (request.query.filters) {
          try {
            filters = JSON.parse(request.query.filters)
          } catch { /* ignore */ }
        }
        const result = getAllPosts(page, pageSize, filters)
        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  server.get('/api/posts/tags', async () => {
    try {
      const tags = getAllTags()
      return { success: true, data: tags }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get<{ Params: { secUid: string; folderName: string } }>(
    '/api/posts/:secUid/:folderName/cover',
    async (request, reply) => {
      try {
        const { secUid, folderName } = request.params
        const coverPath = findCoverFile(secUid, folderName)
        if (!coverPath || !existsSync(coverPath)) {
          return reply.code(404).send({ success: false, error: 'Cover not found' })
        }

        const ext = coverPath.split('.').pop()?.toLowerCase() || 'jpg'
        const mimeTypes: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
          gif: 'image/gif'
        }

        const fileStat = statSync(coverPath)
        reply.header('Content-Type', mimeTypes[ext] || 'image/jpeg')
        reply.header('Content-Length', fileStat.size)
        reply.header('Cache-Control', 'public, max-age=86400')
        return reply.send(createReadStream(coverPath))
      } catch (error) {
        return reply.code(500).send({ success: false, error: (error as Error).message })
      }
    }
  )

  server.get<{ Params: { secUid: string; folderName: string }; Querystring: { awemeType?: string } }>(
    '/api/posts/:secUid/:folderName/media',
    async (request) => {
      try {
        const { secUid, folderName } = request.params
        const awemeType = parseInt(request.query.awemeType || '0')
        const media = findMediaFiles(secUid, folderName, awemeType)
        return { success: true, data: media }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )
}
