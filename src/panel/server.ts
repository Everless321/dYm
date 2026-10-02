import { randomBytes } from 'crypto'
import { createReadStream, existsSync, statSync } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { resolve } from 'path'
import { WebSocketServer } from 'ws'
import { isPanelMethod } from '../shared/panel'
import { PanelHub, PanelHttpError } from './hub'
import { PanelStore, secretsEqual } from './store'

const SESSION_COOKIE = 'dym_panel'
const SESSION_MAX_AGE = 7 * 24 * 60 * 60
const SLOW_METHODS = new Set(['users.add', 'users.refresh', 'users.delete', 'tasks.delete'])

const STATIC_FILES: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/app.css': 'app.css'
}

export interface PanelServerOptions {
  port: number
  host: string
  dataDir: string
  publicDir: string
  adminToken: string
}

export interface RunningPanel {
  port: number
  host: string
  issueKey: (name: string) => { id: string; key: string; name: string; nodeId: string }
  close: () => Promise<void>
}

export interface PanelGateway {
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>
  attach(server: Server): void
  issueKey: (name: string) => { id: string; key: string; name: string; nodeId: string }
  close: () => Promise<void>
}

/** 协议处理可以挂到已有 HTTP 服务上。页面不归这里管时，未识别的请求返回 false。 */
export function createPanelGateway(options: {
  dataDir: string
  adminToken: string
  publicDir?: string
}): PanelGateway {
  const store = new PanelStore(options.dataDir)
  const hub = new PanelHub(store)
  const sessions = new Map<string, number>()
  const publicDir = options.publicDir ? resolve(options.publicDir) : ''
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
  wss.on('connection', (ws) => hub.handleSocket(ws))
  wss.on('error', (error) => console.error('[Panel] WebSocket 错误:', error))

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
    const pathname = decodeURIComponent(url.pathname)

    if (publicDir && method === 'GET' && STATIC_FILES[pathname]) {
      serveStatic(response, publicDir, STATIC_FILES[pathname])
      return true
    }

    if (pathname === '/api/login' && method === 'POST') {
      requirePanelHeader(request)
      const body = await readJson(request)
      const token = typeof body.token === 'string' ? body.token : ''
      if (!token || !secretsEqual(token, options.adminToken)) {
        sendJson(response, 401, { error: '口令不正确' })
        return true
      }
      const session = randomBytes(32).toString('base64url')
      sessions.set(session, Date.now())
      response.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`
      )
      sendJson(response, 200, { ok: true })
      return true
    }

    if (pathname.startsWith('/api/')) {
      const session = readCookie(request, SESSION_COOKIE)
      if (!session || !sessions.has(session)) {
        sendJson(response, 401, { error: '请先登录' })
        return true
      }
      if (method === 'POST') requirePanelHeader(request)
    }

    if (pathname === '/api/logout' && method === 'POST') {
      const session = readCookie(request, SESSION_COOKIE)
      if (session) sessions.delete(session)
      response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0`)
      sendJson(response, 200, { ok: true })
      return true
    }

    if (pathname === '/api/me' && method === 'GET') {
      sendJson(response, 200, { ok: true })
      return true
    }

    if (pathname === '/api/nodes' && method === 'GET') {
      sendJson(response, 200, { nodes: hub.listNodes() })
      return true
    }

    if (pathname === '/api/keys' && method === 'GET') {
      sendJson(response, 200, { keys: hub.listKeys() })
      return true
    }

    if (pathname === '/api/keys' && method === 'POST') {
      const body = await readJson(request)
      const name = typeof body.name === 'string' ? body.name : ''
      const issued = hub.issueKey(name)
      sendJson(response, 200, issued)
      return true
    }

    const keyMatch = pathname.match(/^\/api\/keys\/([^/]+)$/)
    if (keyMatch && method === 'DELETE') {
      hub.revokeKey(decodeURIComponent(keyMatch[1]))
      sendJson(response, 200, { ok: true })
      return true
    }

    const nodeMatch = pathname.match(/^\/api\/nodes\/([^/]+)(?:\/([^/]+))?$/)
    if (nodeMatch) {
      const nodeId = decodeURIComponent(nodeMatch[1])
      const action = nodeMatch[2] ?? ''
      if (!hub.listNodes().some((node) => node.id === nodeId)) {
        sendJson(response, 404, { error: '客户端不存在' })
        return true
      }
      if (!action && method === 'GET') {
        sendJson(response, 200, { node: hub.listNodes().find((node) => node.id === nodeId) })
        return true
      }
      if (action === 'rpc' && method === 'POST') {
        const body = await readJson(request)
        const rpcMethod = typeof body.method === 'string' ? body.method : ''
        if (!isPanelMethod(rpcMethod)) {
          sendJson(response, 400, { error: '不支持的操作' })
          return true
        }
        const timeout = SLOW_METHODS.has(rpcMethod) ? 120_000 : 20_000
        const result = await hub.rpc(nodeId, rpcMethod, body.params ?? {}, timeout)
        sendJson(response, 200, { result })
        return true
      }
      if (action === 'events' && method === 'GET') {
        serveEvents(response, hub, nodeId)
        return true
      }
      if (action === 'media' && method === 'GET') {
        await serveMedia(request, response, hub, nodeId, url.searchParams.get('token') ?? '')
        return true
      }
    }

    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: '没有这个接口' })
      return true
    }
    return false
  }

  return {
    handle,
    attach(server) {
      server.on('upgrade', (request, socket, head) => {
        let pathname = ''
        try {
          pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
        } catch {
          socket.destroy()
          return
        }
        if (pathname !== '/agent') return
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request)
        })
      })
    },
    issueKey: (name) => hub.issueKey(name),
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        hub.closeAll()
        wss.close((error) => {
          if (error) rejectClose(error)
          else resolveClose()
        })
      })
  }
}

export async function createPanelServer(options: PanelServerOptions): Promise<RunningPanel> {
  const gateway = createPanelGateway(options)
  const server = createServer((request, response) => {
    void gateway.handle(request, response).then(
      (handled) => {
        if (!handled && !response.writableEnded) {
          sendJson(response, 404, { error: '没有这个接口' })
        }
      },
      (error: unknown) => {
        if (response.headersSent || response.writableEnded) {
          if (!response.destroyed) response.destroy()
          return
        }
        if (error instanceof PanelHttpError) {
          sendJson(response, error.status, { error: error.message })
          return
        }
        const message = error instanceof Error ? error.message : '内部错误'
        console.error('[Panel] 请求失败:', error)
        sendJson(response, 502, { error: message || '内部错误' })
      }
    )
  })
  gateway.attach(server)

  await new Promise<void>((resolveListen, rejectListen) => {
    const fail = (error: Error): void => {
      server.off('listening', ok)
      rejectListen(error)
    }
    const ok = (): void => {
      server.off('error', fail)
      resolveListen()
    }
    server.once('error', fail)
    server.once('listening', ok)
    server.listen(options.port, options.host)
  })

  server.on('error', (error) => {
    console.error('[Panel] 服务错误:', error)
  })

  const address = server.address()
  const port = address && typeof address === 'object' ? address.port : options.port
  return {
    port,
    host: options.host,
    issueKey: (name) => gateway.issueKey(name),
    close: () =>
      gateway.close().then(
        () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) rejectClose(error)
              else resolveClose()
            })
            server.closeAllConnections()
          })
      )
  }
}

function serveStatic(response: ServerResponse, publicDir: string, name: string): void {
  const file = resolve(publicDir, name)
  if (!file.startsWith(publicDir) || !existsSync(file)) {
    sendJson(response, 404, { error: '页面不存在' })
    return
  }
  const type = name.endsWith('.css')
    ? 'text/css; charset=utf-8'
    : name.endsWith('.js')
      ? 'application/javascript; charset=utf-8'
      : 'text/html; charset=utf-8'
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': statSync(file).size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  createReadStream(file).pipe(response)
}

function serveEvents(response: ServerResponse, hub: PanelHub, nodeId: string): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff'
  })
  response.write(': ok\n\n')
  const unsubscribe = hub.subscribe(nodeId, {
    write: (event, data) => {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
  })
  const ping = setInterval(() => {
    if (!response.writableEnded) response.write(': ping\n\n')
  }, 15_000)
  response.on('close', () => {
    clearInterval(ping)
    unsubscribe()
  })
}

async function serveMedia(
  request: IncomingMessage,
  response: ServerResponse,
  hub: PanelHub,
  nodeId: string,
  token: string
): Promise<void> {
  if (!token) throw new PanelHttpError('缺少文件参数', 400)
  const stat = (await hub.rpc(nodeId, 'media.stat', { token }, 20_000)) as {
    kind?: string
    size?: number
    mime?: string
  }
  if (!stat || stat.kind !== 'file' || typeof stat.size !== 'number') {
    throw new PanelHttpError('文件不存在', 404)
  }
  const size = stat.size
  const range = parseRange(request.headers.range, size)
  if (range === 'invalid') {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` })
    response.end()
    return
  }
  const start = range === 'full' ? 0 : range.start
  const end = range === 'full' ? size : range.end
  const length = end - start
  const headers: Record<string, string | number> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': stat.mime || 'application/octet-stream',
    'Content-Length': length,
    'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff'
  }
  if (range !== 'full') {
    headers['Content-Range'] = `bytes ${start}-${end - 1}/${size}`
    response.writeHead(206, headers)
  } else {
    response.writeHead(200, headers)
  }
  if (length === 0) {
    response.end()
    return
  }
  const stream = hub.openMedia(nodeId, token, start, end)
  const stop = (): void => {
    if (!stream.destroyed) stream.destroy()
  }
  request.on('close', () => {
    if (!response.writableEnded) stop()
  })
  stream.on('error', (error) => {
    console.error('[Panel] 转发媒体失败:', error)
    if (!response.writableEnded) response.destroy()
  })
  stream.pipe(response)
}

function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | 'full' | 'invalid' {
  if (!header) return 'full'
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size < 0) return 'invalid'
  let start: number
  let inclusiveEnd: number
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isInteger(suffix) || suffix <= 0) return 'invalid'
    start = Math.max(0, size - suffix)
    inclusiveEnd = size - 1
  } else {
    start = Number(match[1])
    inclusiveEnd = match[2] === '' ? size - 1 : Number(match[2])
  }
  if (!Number.isInteger(start) || !Number.isInteger(inclusiveEnd)) return 'invalid'
  if (start < 0 || start >= size || inclusiveEnd < start) return 'invalid'
  return { start, end: Math.min(inclusiveEnd, size - 1) + 1 }
}

function requirePanelHeader(request: IncomingMessage): void {
  if (request.headers['x-panel'] !== '1') {
    throw new PanelHttpError('拒绝跨站请求', 403)
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readBody(request)
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new PanelHttpError('请求格式不正确', 400)
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof PanelHttpError) throw error
    throw new PanelHttpError('请求格式不正确', 400)
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
        rejectBody(new PanelHttpError('请求体过大', 413))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    request.on('error', rejectBody)
  })
}

function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim())
    }
  }
  return null
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body)
  })
  response.end(body)
}
