import { hostname, platform } from 'os'
import { createReadStream, existsSync, type ReadStream } from 'fs'
import { WebSocket } from 'ws'
import {
  encodeMediaFrame,
  EMPTY_COUNTS,
  EMPTY_LOGIN,
  transferIdHex,
  type PanelLogin,
  type PanelSnapshot
} from '../../../shared/panel'
import { dispatchPanelCommand, readLocalLogin, resolvePanelMediaFile } from './commands'
import { onPanelProgress } from './progress'

export type AgentLinkState = 'connecting' | 'online' | 'error'

export interface PanelAgent {
  stop: () => void
}

interface AgentOptions {
  url: string
  apiKey: string
  name: string
  version: string
  onStatus: (state: AgentLinkState, error: string | null) => void
}

const HEARTBEAT_MS = 15_000
const ACCOUNT_MS = 5 * 60_000
const MEDIA_PARALLEL = 4

export function toAgentWebSocketUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('管理端地址不正确')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('管理端地址需要以 http:// 或 https:// 开头')
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/agent'
  url.search = ''
  url.hash = ''
  return url.toString()
}

/**
 * 出站连上管理端，注册之后执行对面发来的操作。
 * Cookie 和文件都留在这台机器上。
 */
export function startPanelAgent(options: AgentOptions): PanelAgent {
  let stopped = false
  let socket: WebSocket | null = null
  let reconnect: NodeJS.Timeout | null = null
  let heartbeat: NodeJS.Timeout | null = null
  let accountTimer: NodeJS.Timeout | null = null
  let delay = 1000
  let account: PanelLogin = { ...EMPTY_LOGIN }
  let unsubscribe = (): void => {}
  const streams = new Map<string, ReadStream>()
  const acks = new Map<string, () => void>()
  let mediaActive = 0
  const mediaQueue: Array<() => void> = []

  const endpoint = toAgentWebSocketUrl(options.url)

  const send = (message: unknown): void => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  const snapshot = (): PanelSnapshot => {
    const login = readLocalLogin()
    if (!login.loggedIn) account = { ...EMPTY_LOGIN }
    return {
      name: options.name,
      version: options.version,
      hostname: hostname(),
      platform: platform(),
      login: login.loggedIn
        ? { ...login, uniqueId: account.uniqueId, nickname: account.nickname }
        : login,
      counts: { ...EMPTY_COUNTS },
      at: Date.now()
    }
  }

  const publish = async (): Promise<void> => {
    try {
      const status = (await dispatchPanelCommand('status.get', {})) as {
        counts?: PanelSnapshot['counts']
      }
      const current = snapshot()
      if (status.counts) current.counts = status.counts
      send({ type: 'heartbeat', snapshot: current })
    } catch (error) {
      console.error('[Panel] 心跳失败:', error)
    }
  }

  const refreshAccount = async (): Promise<void> => {
    try {
      account = (await dispatchPanelCommand('account.get', {})) as PanelLogin
      await publish()
    } catch (error) {
      console.error('[Panel] 刷新登录状态失败:', error)
    }
  }

  const finishMedia = (): void => {
    mediaActive = Math.max(0, mediaActive - 1)
    const next = mediaQueue.shift()
    if (next) {
      mediaActive += 1
      next()
    }
  }

  const scheduleMedia = (work: () => void): void => {
    if (mediaActive >= MEDIA_PARALLEL) mediaQueue.push(work)
    else {
      mediaActive += 1
      work()
    }
  }

  const openMedia = (transferId: string, token: string, start: number, end: number): void => {
    const ws = socket
    if (!ws || stopped) return
    let file = ''
    try {
      file = resolvePanelMediaFile(token)
    } catch (error) {
      ws.send(encodeMediaFrame(3, transferId, Buffer.from((error as Error).message)))
      return
    }
    if (!existsSync(file) || end <= start) {
      ws.send(
        encodeMediaFrame(3, transferId, Buffer.from(end <= start ? '范围为空' : '文件不存在'))
      )
      return
    }
    scheduleMedia(() => {
      if (stopped || socket !== ws || ws.readyState !== WebSocket.OPEN) {
        finishMedia()
        return
      }
      const stream = createReadStream(file, {
        start,
        end: end - 1,
        highWaterMark: 256 * 1024
      })
      const idHex = transferIdHex(transferId)
      streams.set(idHex, stream)
      let waiting = false
      let acked = false
      const release = (): void => {
        acks.delete(idHex)
        if (streams.delete(idHex)) finishMedia()
      }
      const resume = (): void => {
        if (!stream.destroyed) stream.resume()
      }
      acks.set(idHex, () => {
        acked = true
        if (waiting) {
          waiting = false
          acked = false
          resume()
        }
      })
      stream.on('data', (chunk: Buffer | string) => {
        stream.pause()
        const payload = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        ws.send(encodeMediaFrame(1, transferId, payload), (error) => {
          if (error || stream.destroyed) {
            stream.destroy()
            return
          }
          if (acked) {
            acked = false
            resume()
          } else {
            waiting = true
          }
        })
      })
      stream.on('end', () => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeMediaFrame(2, transferId))
        release()
      })
      stream.on('error', (error) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encodeMediaFrame(3, transferId, Buffer.from(error.message)))
        }
        release()
      })
      stream.on('close', () => {
        if (streams.has(idHex)) release()
      })
    })
  }

  const connect = (): void => {
    if (stopped) return
    options.onStatus('connecting', null)
    const ws = new WebSocket(endpoint, { maxPayload: 2 * 1024 * 1024 })
    socket = ws
    let opened = false

    ws.on('open', () => {
      opened = true
      send({
        type: 'register',
        apiKey: options.apiKey,
        name: options.name,
        version: options.version,
        hostname: hostname(),
        platform: platform()
      })
    })

    ws.on('message', (data, isBinary) => {
      if (isBinary) return
      let message: Record<string, unknown>
      try {
        message = JSON.parse(data.toString()) as Record<string, unknown>
      } catch {
        return
      }
      if (message.type === 'registered') {
        delay = 1000
        options.onStatus('online', null)
        void publish()
        void refreshAccount()
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = setInterval(() => void publish(), HEARTBEAT_MS)
        if (accountTimer) clearInterval(accountTimer)
        accountTimer = setInterval(() => void refreshAccount(), ACCOUNT_MS)
        return
      }
      if (message.type === 'error') {
        options.onStatus(
          'error',
          typeof message.message === 'string' ? message.message : '注册失败'
        )
        return
      }
      if (
        message.type === 'rpc' &&
        typeof message.id === 'string' &&
        typeof message.method === 'string'
      ) {
        void dispatchPanelCommand(message.method, message.params)
          .then((result) => send({ type: 'rpc-result', id: message.id, ok: true, result }))
          .catch((error: Error) =>
            send({
              type: 'rpc-result',
              id: message.id,
              ok: false,
              error: error.message || '操作失败'
            })
          )
        return
      }
      if (
        message.type === 'media-open' &&
        typeof message.transferId === 'string' &&
        typeof message.token === 'string' &&
        typeof message.start === 'number' &&
        typeof message.end === 'number'
      ) {
        openMedia(message.transferId, message.token, message.start, message.end)
        return
      }
      if (message.type === 'media-ack' && typeof message.transferId === 'string') {
        try {
          acks.get(transferIdHex(message.transferId))?.()
        } catch {
          // 传输号无效就忽略这一次确认
        }
        return
      }
      if (message.type === 'media-cancel' && typeof message.transferId === 'string') {
        try {
          streams.get(transferIdHex(message.transferId))?.destroy()
        } catch {
          // 传输号无效就忽略
        }
      }
    })

    ws.on('close', () => {
      if (socket === ws) socket = null
      if (heartbeat) clearInterval(heartbeat)
      if (accountTimer) clearInterval(accountTimer)
      heartbeat = null
      accountTimer = null
      for (const stream of streams.values()) stream.destroy()
      acks.clear()
      if (stopped) return
      options.onStatus('error', opened ? '连接已断开' : '无法连接管理端')
      reconnect = setTimeout(connect, delay)
      delay = Math.min(delay * 2, 30_000)
    })

    ws.on('error', (error) => {
      console.error('[Panel] 节点连接失败:', error.message)
    })
  }

  unsubscribe = onPanelProgress((event, data) => {
    send({ type: 'event', event, data })
  })
  connect()

  return {
    stop: () => {
      stopped = true
      unsubscribe()
      if (reconnect) clearTimeout(reconnect)
      if (heartbeat) clearInterval(heartbeat)
      if (accountTimer) clearInterval(accountTimer)
      for (const stream of streams.values()) stream.destroy()
      socket?.close(1000, 'stop')
      socket = null
    }
  }
}
