import { useEffect, useRef, useCallback } from 'react'
import type {
  WsEvent,
  SyncProgress,
  DownloadProgress,
  AnalysisProgress,
  SchedulerLog
} from '@dym/shared'

type WsListeners = {
  'sync:progress'?: (data: SyncProgress) => void
  'download:progress'?: (data: DownloadProgress) => void
  'analysis:progress'?: (data: AnalysisProgress) => void
  'scheduler:log'?: (data: SchedulerLog) => void
}

let globalWs: WebSocket | null = null
let globalListeners: WsListeners = {}
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function connect(): void {
  if (globalWs?.readyState === WebSocket.OPEN) return

  globalWs = new WebSocket(getWsUrl())

  globalWs.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as WsEvent
      const handler = globalListeners[parsed.channel]
      if (handler) (handler as (data: unknown) => void)(parsed.data)
    } catch {
      // ignore malformed messages
    }
  }

  globalWs.onclose = () => {
    reconnectTimer = setTimeout(connect, 3000)
  }

  globalWs.onerror = () => {
    globalWs?.close()
  }
}

function ensureConnection(): void {
  if (!globalWs || globalWs.readyState === WebSocket.CLOSED) {
    connect()
  }
}

export function useWsChannel<K extends keyof WsListeners>(
  channel: K,
  handler: NonNullable<WsListeners[K]>
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    ensureConnection()

    const wrapped = (data: unknown): void => {
      (handlerRef.current as (data: unknown) => void)(data)
    }
    globalListeners[channel] = wrapped as WsListeners[K]

    return () => {
      delete globalListeners[channel]
    }
  }, [channel])
}

export function disconnectWs(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  globalWs?.close()
  globalWs = null
}
