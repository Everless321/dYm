import { randomUUID } from 'crypto'
import { PassThrough } from 'stream'
import type { WebSocket } from 'ws'
import {
  decodeMediaFrame,
  EMPTY_COUNTS,
  EMPTY_LOGIN,
  isPanelMethod,
  transferIdHex,
  type PanelCounts,
  type PanelKeyView,
  type PanelLogin,
  type PanelNodeView,
  type PanelSnapshot
} from '../shared/panel'
import { PanelStore } from './store'

const REGISTER_WAIT_MS = 5_000
const RPC_DEFAULT_MS = 20_000
const MEDIA_IDLE_MS = 60_000

export class PanelHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

interface PendingRpc {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface MediaTransfer {
  onChunk: (chunk: Buffer) => void
  onEnd: () => void
  onError: (message: string) => void
}

interface NodeConn {
  ws: WebSocket
  nodeId: string
  keyId: string
  pending: Map<string, PendingRpc>
  lastSeen: number
}

interface SseClient {
  write: (event: string, data: unknown) => void
}

/**
 * 已连接的节点。浏览器的操作从这里转发到对应连接，
 * 作品文件也从这条连接上把数据块拉回来。
 */
export class PanelHub {
  private conns = new Map<string, NodeConn>()
  private transfers = new Map<string, MediaTransfer>()
  private listeners = new Map<string, Set<SseClient>>()

  constructor(private readonly store: PanelStore) {}

  handleSocket(ws: WebSocket): void {
    let conn: NodeConn | null = null
    const registerTimer = setTimeout(() => {
      if (!conn) {
        this.send(ws, { type: 'error', message: '注册超时' })
        ws.close(4001, 'register timeout')
      }
    }, REGISTER_WAIT_MS)

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this.onBinary(data as Buffer)
        return
      }
      let message: Record<string, unknown>
      try {
        message = JSON.parse(data.toString()) as Record<string, unknown>
      } catch {
        this.send(ws, { type: 'error', message: '无法解析消息' })
        return
      }
      if (!conn) {
        conn = this.onRegister(ws, message)
        if (conn) clearTimeout(registerTimer)
        return
      }
      conn.lastSeen = Date.now()
      this.onAgentMessage(conn, message)
    })

    const detach = (): void => {
      clearTimeout(registerTimer)
      if (!conn) return
      if (this.conns.get(conn.nodeId) === conn) this.conns.delete(conn.nodeId)
      for (const pending of conn.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new PanelHttpError('客户端已断开', 409))
      }
      conn.pending.clear()
      this.broadcast(conn.nodeId, 'status', { online: false })
    }
    ws.on('close', detach)
    ws.on('error', (error) => {
      console.error('[Panel] 节点连接异常:', error)
    })
  }

  listNodes(): PanelNodeView[] {
    const keys = new Map(this.store.listKeys().map((key) => [key.id, key]))
    return this.store.listNodes().map((node) => {
      const online = this.conns.has(node.id)
      return {
        id: node.id,
        name: node.name || '未命名',
        online,
        hostname: node.hostname,
        version: node.version,
        platform: node.platform,
        lastSeen: node.lastSeen || null,
        login: node.login ?? { ...EMPTY_LOGIN },
        counts: node.counts ?? { ...EMPTY_COUNTS },
        keyId: node.keyId,
        keyPrefix: keys.get(node.keyId)?.prefix ?? ''
      }
    })
  }

  listKeys(): PanelKeyView[] {
    const nodes = new Map(this.store.listNodes().map((node) => [node.keyId, node]))
    return this.store.listKeys().map((key) => {
      const node = nodes.get(key.id)
      return {
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        createdAt: key.createdAt,
        nodeId: node?.id ?? '',
        online: node ? this.conns.has(node.id) : false
      }
    })
  }

  issueKey(name: string): { id: string; key: string; name: string; nodeId: string } {
    return this.store.issueKey(name)
  }

  revokeKey(id: string): void {
    const node = this.store.revokeKey(id)
    if (!node) throw new PanelHttpError('密钥不存在', 404)
    const conn = this.conns.get(node.id)
    if (conn) {
      this.send(conn.ws, { type: 'error', message: '密钥已吊销' })
      conn.ws.close(4001, 'revoked')
    }
  }

  async rpc(
    nodeId: string,
    method: string,
    params: unknown,
    timeoutMs = RPC_DEFAULT_MS
  ): Promise<unknown> {
    if (!isPanelMethod(method)) throw new PanelHttpError('不支持的操作', 400)
    const conn = this.conns.get(nodeId)
    if (!conn) throw new PanelHttpError('客户端离线', 409)
    const id = randomUUID()
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id)
        reject(new PanelHttpError('客户端响应超时', 504))
      }, timeoutMs)
      conn.pending.set(id, { resolve, reject, timer })
    })
    this.send(conn.ws, { type: 'rpc', id, method, params: params ?? {} })
    return result
  }

  openMedia(nodeId: string, token: string, start: number, end: number): PassThrough {
    const conn = this.conns.get(nodeId)
    const stream = new PassThrough()
    if (!conn || conn.ws.readyState !== conn.ws.OPEN) {
      stream.destroy(new PanelHttpError('客户端离线', 409))
      return stream
    }
    const transferId = randomUUID()
    let idHex: string
    try {
      idHex = transferIdHex(transferId)
    } catch (error) {
      stream.destroy(error as Error)
      return stream
    }
    let timer: NodeJS.Timeout
    let alive = true
    const finish = (error?: Error): void => {
      alive = false
      clearTimeout(timer)
      this.transfers.delete(idHex)
      if (error && !stream.destroyed) stream.destroy(error)
    }
    const arm = (): void => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(new Error('读取文件超时')), MEDIA_IDLE_MS)
    }
    const ack = (): void => {
      // 每确认一块再让节点发下一块，避免浏览器读得慢时把整段视频堆在内存里
      if (!alive || conn.ws.readyState !== conn.ws.OPEN) return
      this.send(conn.ws, { type: 'media-ack', transferId })
    }
    arm()
    this.transfers.set(idHex, {
      onChunk: (chunk) => {
        if (!alive) return
        arm()
        if (stream.write(chunk)) ack()
        else stream.once('drain', ack)
      },
      onEnd: () => {
        alive = false
        clearTimeout(timer)
        this.transfers.delete(idHex)
        stream.end()
      },
      onError: (message) => finish(new Error(message))
    })
    stream.on('close', () => {
      alive = false
      if (!this.transfers.has(idHex)) return
      this.transfers.delete(idHex)
      clearTimeout(timer)
      if (conn.ws.readyState === conn.ws.OPEN) {
        this.send(conn.ws, { type: 'media-cancel', transferId })
      }
    })
    this.send(conn.ws, { type: 'media-open', transferId, token, start, end })
    return stream
  }

  subscribe(nodeId: string, client: SseClient): () => void {
    const set = this.listeners.get(nodeId) ?? new Set()
    set.add(client)
    this.listeners.set(nodeId, set)
    return () => {
      set.delete(client)
      if (set.size === 0) this.listeners.delete(nodeId)
    }
  }

  closeAll(): void {
    for (const conn of this.conns.values()) conn.ws.close(1001, 'shutdown')
    this.conns.clear()
  }

  private onRegister(ws: WebSocket, message: Record<string, unknown>): NodeConn | null {
    if (message.type !== 'register' || typeof message.apiKey !== 'string') {
      this.send(ws, { type: 'error', message: '请先注册' })
      ws.close(4001, 'register required')
      return null
    }
    const auth = this.store.authenticate(message.apiKey)
    if (!auth) {
      this.send(ws, { type: 'error', message: 'API Key 无效' })
      ws.close(4001, 'unauthorized')
      return null
    }
    const previous = this.conns.get(auth.node.id)
    if (previous) previous.ws.close(4000, 'replaced')
    const name = typeof message.name === 'string' ? message.name.trim().slice(0, 64) : ''
    this.store.updateNode(auth.node.id, {
      name: name || auth.node.name,
      hostname: clip(message.hostname, 128),
      version: clip(message.version, 32),
      platform: clip(message.platform, 32),
      lastSeen: Date.now()
    })
    const conn: NodeConn = {
      ws,
      nodeId: auth.node.id,
      keyId: auth.key.id,
      pending: new Map(),
      lastSeen: Date.now()
    }
    this.conns.set(auth.node.id, conn)
    this.send(ws, { type: 'registered', nodeId: auth.node.id })
    this.broadcast(auth.node.id, 'status', { online: true })
    return conn
  }

  private onAgentMessage(conn: NodeConn, message: Record<string, unknown>): void {
    if (message.type === 'heartbeat') {
      const snapshot = asSnapshot(message.snapshot)
      if (!snapshot) return
      this.store.updateNode(conn.nodeId, {
        name: snapshot.name || undefined,
        hostname: snapshot.hostname,
        version: snapshot.version,
        platform: snapshot.platform,
        lastSeen: Date.now(),
        login: snapshot.login,
        counts: snapshot.counts
      })
      this.broadcast(conn.nodeId, 'snapshot', snapshot)
      return
    }
    if (message.type === 'rpc-result' && typeof message.id === 'string') {
      const pending = conn.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      conn.pending.delete(message.id)
      if (message.ok === true) pending.resolve(message.result)
      else pending.reject(new Error(typeof message.error === 'string' ? message.error : '操作失败'))
      return
    }
    if (message.type === 'event' && typeof message.event === 'string') {
      this.broadcast(conn.nodeId, message.event, message.data ?? null)
    }
  }

  private onBinary(data: Buffer): void {
    const frame = decodeMediaFrame(data)
    if (!frame) return
    const transfer = this.transfers.get(frame.idHex)
    if (!transfer) return
    if (frame.kind === 1) transfer.onChunk(frame.payload)
    else if (frame.kind === 2) transfer.onEnd()
    else if (frame.kind === 3) transfer.onError(frame.payload.toString('utf8') || '读取失败')
  }

  private broadcast(nodeId: string, event: string, data: unknown): void {
    const set = this.listeners.get(nodeId)
    if (!set) return
    for (const client of set) {
      try {
        client.write(event, data)
      } catch (error) {
        console.error('[Panel] 推送事件失败:', error)
      }
    }
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
  }
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function asSnapshot(value: unknown): PanelSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<PanelSnapshot>
  const login = asLogin(raw.login)
  const counts = asCounts(raw.counts)
  if (!login || !counts) return null
  return {
    name: clip(raw.name, 64),
    version: clip(raw.version, 32),
    hostname: clip(raw.hostname, 128),
    platform: clip(raw.platform, 32),
    login,
    counts,
    at: typeof raw.at === 'number' ? raw.at : Date.now()
  }
}

function asLogin(value: unknown): PanelLogin | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<PanelLogin>
  return {
    loggedIn: raw.loggedIn === true,
    nickname: typeof raw.nickname === 'string' ? raw.nickname : null,
    uniqueId: typeof raw.uniqueId === 'string' ? raw.uniqueId : null
  }
}

function asCounts(value: unknown): PanelCounts | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<PanelCounts>
  return {
    users: num(raw.users),
    posts: num(raw.posts),
    runningTasks: num(raw.runningTasks),
    syncingUsers: num(raw.syncingUsers)
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
