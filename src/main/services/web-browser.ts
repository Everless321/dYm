import { app } from 'electron'
import { createReadStream, existsSync, statSync } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import os from 'os'
import { extname, join, normalize, resolve } from 'path'
import { getAllPosts, getAllTags, getSetting, type DbPost, type PostFilters } from '../database'
import {
  findCoverFile,
  findMediaFiles,
  fromUrlPath,
  getDownloadPath,
  isPathInDownloadRoot
} from './media'

const DEFAULT_WEB_SERVER_PORT = 38595
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 24

export interface WebServerInfo {
  started: boolean
  port: number
  preferredPort: number
  origin: string
  urls: string[]
}

let webServer: Server | null = null
let activePort = DEFAULT_WEB_SERVER_PORT

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
}

function getPreferredPort(): number {
  const rawValue = getSetting('web_server_port')
  const parsed = Number.parseInt(rawValue ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
    return parsed
  }
  return DEFAULT_WEB_SERVER_PORT
}

function getLocalUrls(port: number): string[] {
  const urls = new Set<string>([`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  const networkInterfaces = os.networkInterfaces()

  for (const entries of Object.values(networkInterfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.add(`http://${entry.address}:${port}`)
      }
    }
  }

  return Array.from(urls)
}

export function getWebServerInfo(): WebServerInfo {
  const preferredPort = getPreferredPort()
  const port = webServer ? activePort : preferredPort
  const urls = getLocalUrls(port)
  return {
    started: Boolean(webServer),
    port,
    preferredPort,
    origin: urls[0],
    urls
  }
}

function resolveWebAssetDir(): string {
  const candidates = [
    join(process.cwd(), 'resources', 'web'),
    join(process.resourcesPath, 'web'),
    join(process.resourcesPath, 'resources', 'web'),
    join(app.getAppPath(), 'resources', 'web')
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[0]
}

function respondJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  })
  response.end(JSON.stringify(payload))
}

function respondError(response: ServerResponse, statusCode: number, message: string): void {
  respondJson(response, statusCode, { error: message })
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined
  if (value === '1' || value.toLowerCase() === 'true') return true
  if (value === '0' || value.toLowerCase() === 'false') return false
  return undefined
}

function parseInteger(
  value: string | null,
  fallback: number,
  { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}
): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function parseTags(rawValue: string | null): string[] {
  if (!rawValue) return []
  try {
    const parsed = JSON.parse(rawValue)
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : []
  } catch {
    return []
  }
}

function createMediaToken(filePath: string): string {
  return Buffer.from(fromUrlPath(filePath)).toString('base64url')
}

function buildMediaUrl(filePath?: string | null): string | null {
  if (!filePath) return null
  return `/media?path=${encodeURIComponent(createMediaToken(filePath))}`
}

function buildWebPost(post: DbPost) {
  const media = post.folder_name
    ? findMediaFiles(post.sec_uid, post.folder_name, post.aweme_type)
    : null
  const coverPath =
    media?.cover ?? (post.folder_name ? findCoverFile(post.sec_uid, post.folder_name) : null)

  return {
    id: post.id,
    awemeId: post.aweme_id,
    author: {
      nickname: post.nickname,
      secUid: post.sec_uid
    },
    caption: post.caption,
    desc: post.desc,
    createTime: post.create_time,
    awemeType: post.aweme_type,
    isImagePost: post.aweme_type === 68,
    coverUrl: buildMediaUrl(coverPath),
    media: media
      ? {
          type: media.type,
          videoUrl: buildMediaUrl(media.video),
          imageUrls: media.images?.map((image) => buildMediaUrl(image)).filter(Boolean) ?? [],
          musicUrl: buildMediaUrl(media.music)
        }
      : null,
    analysis: {
      tags: parseTags(post.analysis_tags),
      category: post.analysis_category,
      summary: post.analysis_summary,
      scene: post.analysis_scene,
      contentLevel: post.analysis_content_level
    }
  }
}

function buildFeedFilters(url: URL): PostFilters {
  const tags = url.searchParams.getAll('tag').filter(Boolean)
  const analyzedOnly = parseBoolean(url.searchParams.get('analyzedOnly'))
  const minContentLevel = url.searchParams.get('minContentLevel')
  const maxContentLevel = url.searchParams.get('maxContentLevel')

  return {
    secUid: url.searchParams.get('secUid') || undefined,
    tags: tags.length > 0 ? tags : undefined,
    minContentLevel: minContentLevel ? parseInteger(minContentLevel, 0, { min: 0, max: 10 }) : undefined,
    maxContentLevel: maxContentLevel ? parseInteger(maxContentLevel, 10, { min: 0, max: 10 }) : undefined,
    analyzedOnly,
    keyword: url.searchParams.get('keyword') || undefined
  }
}

function getContentType(filePath: string): string {
  return mimeTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function streamFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
  cacheControl = 'public, max-age=31536000, immutable'
): void {
  const fileStat = statSync(filePath)
  const fileSize = fileStat.size
  const rangeHeader = request.headers.range
  const contentType = getContentType(filePath)

  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Cache-Control', cacheControl)
  response.setHeader('Content-Type', contentType)

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0
      const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
        response.writeHead(416)
        response.end()
        return
      }

      response.writeHead(206, {
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`
      })
      createReadStream(filePath, { start, end }).pipe(response)
      return
    }
  }

  response.writeHead(200, {
    'Content-Length': fileSize
  })
  createReadStream(filePath).pipe(response)
}

function serveStaticAsset(requestPath: string, response: ServerResponse): void {
  const assetRoot = resolveWebAssetDir()
  const normalizedPath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '')
  const relativePath =
    normalizedPath === '/' || normalizedPath === '.' ? 'index.html' : normalizedPath.replace(/^[/\\]+/, '')
  let targetPath = resolve(assetRoot, relativePath)

  if (!targetPath.startsWith(resolve(assetRoot))) {
    respondError(response, 403, 'Forbidden')
    return
  }

  if (!existsSync(targetPath) || requestPath === '/') {
    targetPath = resolve(assetRoot, 'index.html')
  }

  if (!existsSync(targetPath)) {
    respondError(response, 404, 'Not found')
    return
  }

  streamFile({ headers: {} } as IncomingMessage, response, targetPath, 'no-cache')
}

function serveMedia(request: IncomingMessage, response: ServerResponse, url: URL): void {
  const token = url.searchParams.get('path')
  if (!token) {
    respondError(response, 400, 'Missing media path')
    return
  }

  let decodedPath: string
  try {
    decodedPath = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    respondError(response, 400, 'Invalid media path')
    return
  }

  const resolvedPath = fromUrlPath(decodedPath)
  if (!isPathInDownloadRoot(resolvedPath)) {
    respondError(response, 403, 'Forbidden')
    return
  }

  if (!existsSync(resolvedPath)) {
    respondError(response, 404, 'Media not found')
    return
  }

  streamFile(request, response, resolvedPath)
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    respondError(response, 405, 'Method not allowed')
    return
  }

  if (method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Origin': '*'
    })
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  const pathname = decodeURIComponent(url.pathname)

  if (pathname === '/api/info') {
    const info = getWebServerInfo()
    respondJson(response, 200, {
      ...info,
      downloadPath: getDownloadPath()
    })
    return
  }

  if (pathname === '/api/tags') {
    respondJson(response, 200, { tags: getAllTags() })
    return
  }

  if (pathname === '/api/feed') {
    const page = parseInteger(url.searchParams.get('page'), 1, { min: 1 })
    const pageSize = parseInteger(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, {
      min: 1,
      max: MAX_PAGE_SIZE
    })
    const filters = buildFeedFilters(url)
    const result = getAllPosts(page, pageSize, filters)
    respondJson(response, 200, {
      page,
      pageSize,
      total: result.total,
      hasMore: page * pageSize < result.total,
      authors: result.authors,
      posts: result.posts.map(buildWebPost)
    })
    return
  }

  if (pathname === '/media') {
    serveMedia(request, response, url)
    return
  }

  if (pathname === '/favicon.ico') {
    response.writeHead(204)
    response.end()
    return
  }

  serveStaticAsset(pathname, response)
}

function listenOnPort(server: Server, port: number): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const cleanup = () => {
      server.removeListener('error', handleError)
      server.removeListener('listening', handleListening)
    }

    const handleError = (error: NodeJS.ErrnoException) => {
      cleanup()
      rejectPromise(error)
    }

    const handleListening = () => {
      cleanup()
      const address = server.address()
      if (address && typeof address === 'object') {
        resolvePromise(address.port)
        return
      }
      rejectPromise(new Error('Failed to resolve web server port'))
    }

    server.once('error', handleError)
    server.once('listening', handleListening)
    server.listen(port, '0.0.0.0')
  })
}

export async function startWebBrowserServer(): Promise<WebServerInfo> {
  if (webServer) {
    return getWebServerInfo()
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      console.error('[Web] Request failed:', error)
      respondError(response, 500, 'Internal server error')
    })
  })

  const preferredPort = getPreferredPort()

  try {
    activePort = await listenOnPort(server, preferredPort)
  } catch (error) {
    const errno = error as NodeJS.ErrnoException
    if (errno.code !== 'EADDRINUSE') {
      throw error
    }
    activePort = await listenOnPort(server, 0)
  }

  webServer = server
  console.log('[Web] Video browser available at:', getLocalUrls(activePort).join(', '))
  return getWebServerInfo()
}

export async function stopWebBrowserServer(): Promise<void> {
  if (!webServer) return

  await new Promise<void>((resolvePromise, rejectPromise) => {
    webServer?.close((error) => {
      if (error) {
        rejectPromise(error)
        return
      }
      resolvePromise()
    })
  })

  webServer = null
}
