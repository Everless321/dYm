import { app } from 'electron'
import { createReadStream, existsSync, statSync } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import os from 'os'
import { extname, join, normalize, resolve } from 'path'
import {
  getAllPosts,
  getAllTags,
  getSetting,
  getUserBySecUid,
  updateUserSettings,
  type DbPost,
  type DbUser,
  type PostFilters,
  type UpdateUserSettingsInput
} from '../database'
import {
  findCoverFile,
  findMediaFiles,
  fromUrlPath,
  getDownloadPath,
  isPathInDownloadRoot
} from './media'
import { isUserSyncing, startUserSync } from './syncer'
import { scheduleUser, unscheduleUser } from './scheduler'

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
          imageVideoUrls: media.imageVideos?.map((v) => (v ? buildMediaUrl(v) : null)) ?? [],
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
    minContentLevel: minContentLevel
      ? parseInteger(minContentLevel, 0, { min: 0, max: 10 })
      : undefined,
    maxContentLevel: maxContentLevel
      ? parseInteger(maxContentLevel, 10, { min: 0, max: 10 })
      : undefined,
    analyzedOnly,
    keyword: url.searchParams.get('keyword') || undefined
  }
}

function buildAuthorPayload(user: DbUser): Record<string, unknown> {
  return {
    secUid: user.sec_uid,
    nickname: user.nickname,
    signature: user.signature,
    awemeCount: user.aweme_count,
    homepageUrl: user.homepage_url,
    settings: {
      maxDownloadCount: user.max_download_count,
      autoSync: user.auto_sync === 1,
      syncCron: user.sync_cron,
      remark: user.remark
    },
    syncStatus: user.sync_status,
    syncing: isUserSyncing(user.id),
    lastSyncAt: user.last_sync_at
  }
}

function readRequestBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        rejectPromise(new Error('Request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    request.on('error', rejectPromise)
  })
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRequestBody(request)
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON body')
  }
  return parsed as Record<string, unknown>
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
      pipeWithCleanup(createReadStream(filePath, { start, end }), response)
      return
    }
  }

  response.writeHead(200, {
    'Content-Length': fileSize
  })
  pipeWithCleanup(createReadStream(filePath), response)
}

function pipeWithCleanup(
  stream: ReturnType<typeof createReadStream>,
  response: ServerResponse
): void {
  const destroyStream = (): void => {
    if (!stream.destroyed) stream.destroy()
  }
  response.on('close', destroyStream)
  response.on('error', destroyStream)
  stream.on('error', (error: NodeJS.ErrnoException): void => {
    if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error('[Web] Stream error:', error)
    }
    if (!response.writableEnded) response.end()
  })
  stream.pipe(response)
}

function serveStaticAsset(requestPath: string, response: ServerResponse): void {
  const assetRoot = resolveWebAssetDir()
  const normalizedPath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '')
  const relativePath =
    normalizedPath === '/' || normalizedPath === '.'
      ? 'index.html'
      : normalizedPath.replace(/^[/\\]+/, '')
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

async function handleAuthorSettings(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  let body: Record<string, unknown>
  try {
    body = await readJsonBody(request)
  } catch {
    respondError(response, 400, 'Invalid request body')
    return
  }

  const secUid = typeof body.secUid === 'string' ? body.secUid : ''
  if (!secUid) {
    respondError(response, 400, 'Missing secUid')
    return
  }

  const user = getUserBySecUid(secUid)
  if (!user) {
    respondError(response, 404, 'Author not found')
    return
  }

  const settings: UpdateUserSettingsInput = {}

  if (body.maxDownloadCount !== undefined) {
    const value = Number(body.maxDownloadCount)
    if (!Number.isInteger(value) || value < 0 || value > 100000) {
      respondError(response, 400, 'Invalid maxDownloadCount')
      return
    }
    settings.max_download_count = value
  }
  if (body.autoSync !== undefined) {
    settings.auto_sync = Boolean(body.autoSync)
  }
  if (body.syncCron !== undefined) {
    if (typeof body.syncCron !== 'string' || body.syncCron.length > 120) {
      respondError(response, 400, 'Invalid syncCron')
      return
    }
    settings.sync_cron = body.syncCron.trim()
  }
  if (body.remark !== undefined) {
    if (typeof body.remark !== 'string' || body.remark.length > 200) {
      respondError(response, 400, 'Invalid remark')
      return
    }
    settings.remark = body.remark
  }

  const updated = updateUserSettings(user.id, settings)
  if (!updated) {
    respondError(response, 500, 'Failed to update settings')
    return
  }

  // 重新注册定时同步，使配置立即生效（与桌面端 sync:updateUserSchedule 一致）
  if (updated.auto_sync && updated.sync_cron) {
    scheduleUser(updated)
  } else {
    unscheduleUser(updated.id)
  }

  respondJson(response, 200, buildAuthorPayload(updated))
}

async function handleAuthorSync(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let body: Record<string, unknown>
  try {
    body = await readJsonBody(request)
  } catch {
    respondError(response, 400, 'Invalid request body')
    return
  }

  const secUid = typeof body.secUid === 'string' ? body.secUid : ''
  if (!secUid) {
    respondError(response, 400, 'Missing secUid')
    return
  }

  const user = getUserBySecUid(secUid)
  if (!user) {
    respondError(response, 404, 'Author not found')
    return
  }

  if (isUserSyncing(user.id)) {
    respondJson(response, 200, { started: false, syncing: true })
    return
  }

  // 异步触发，不阻塞响应；同步进度可通过轮询 /api/author 查询
  void startUserSync(user.id).catch((error) => {
    console.error('[Web] Author sync failed:', error)
  })
  respondJson(response, 200, { started: true, syncing: true })
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && method !== 'POST') {
    respondError(response, 405, 'Method not allowed')
    return
  }

  if (method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS,POST',
      'Access-Control-Allow-Origin': '*'
    })
    response.end()
    return
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  const pathname = decodeURIComponent(url.pathname)

  if (method === 'POST') {
    if (pathname === '/api/author/settings') {
      await handleAuthorSettings(request, response)
      return
    }
    if (pathname === '/api/author/sync') {
      await handleAuthorSync(request, response)
      return
    }
    respondError(response, 404, 'Not found')
    return
  }

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

  if (pathname === '/api/author') {
    const secUid = url.searchParams.get('secUid')
    if (!secUid) {
      respondError(response, 400, 'Missing secUid')
      return
    }
    const user = getUserBySecUid(secUid)
    if (!user) {
      respondError(response, 404, 'Author not found')
      return
    }
    respondJson(response, 200, buildAuthorPayload(user))
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
