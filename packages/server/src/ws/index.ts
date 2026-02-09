import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { WsEvent } from '@dym/shared'

const clients = new Set<WebSocket>()

export function broadcast(event: WsEvent): void {
  const message = JSON.stringify(event)
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(message)
    }
  }
}

export function registerWsHandler(server: FastifyInstance): void {
  server.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket)
    socket.on('close', () => clients.delete(socket))
    socket.on('error', () => clients.delete(socket))
  })
}
