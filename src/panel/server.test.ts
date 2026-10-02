import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { encodeMediaFrame } from '../shared/panel'
import { createPanelServer, type RunningPanel } from './server'

const token = 'test-admin-token'
let server: RunningPanel
let base: string
let cookie = ''
const publicDir = mkdtempSync(join(tmpdir(), 'dym-panel-public-'))
const dataDir = mkdtempSync(join(tmpdir(), 'dym-panel-data-'))

beforeAll(async () => {
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>panel</title>')
  server = await createPanelServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    publicDir,
    adminToken: token
  })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  await server.close()
})

async function login(): Promise<void> {
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
    body: JSON.stringify({ token })
  })
  expect(response.status).toBe(200)
  const setCookie = response.headers.getSetCookie().find((item) => item.startsWith('dym_panel='))
  expect(setCookie).toBeTruthy()
  cookie = setCookie!.split(';')[0]
}

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Cookie', cookie)
  if (init.body) headers.set('Content-Type', 'application/json')
  if ((init.method || 'GET') !== 'GET') headers.set('X-Panel', '1')
  return fetch(`${base}${path}`, { ...init, headers })
}

describe('panel server', () => {
  it('拒绝错误口令，登录后可以签发密钥并让节点注册', async () => {
    const denied = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
      body: JSON.stringify({ token: 'nope' })
    })
    expect(denied.status).toBe(401)

    const page = await fetch(`${base}/`)
    expect(page.status).toBe(200)

    await login()
    const created = await authed('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ name: '客厅' })
    })
    expect(created.status).toBe(200)
    const issued = (await created.json()) as { key: string; nodeId: string }
    expect(issued.key.startsWith('dym_')).toBe(true)

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/agent`)
    const registered = new Promise<string>((resolve, reject) => {
      ws.on('message', (data, isBinary) => {
        if (isBinary) return
        const message = JSON.parse(data.toString()) as {
          type?: string
          nodeId?: string
          message?: string
        }
        if (message.type === 'registered' && message.nodeId) resolve(message.nodeId)
        if (message.type === 'error') reject(new Error(message.message))
      })
      ws.on('error', reject)
    })
    await new Promise<void>((resolve) => ws.once('open', () => resolve()))
    ws.send(
      JSON.stringify({
        type: 'register',
        apiKey: issued.key,
        name: '客厅电脑',
        version: '3.2.0',
        hostname: 'test',
        platform: 'linux'
      })
    )
    ws.on('message', (data, isBinary) => {
      if (isBinary) return
      const message = JSON.parse(data.toString()) as {
        type?: string
        id?: string
        method?: string
        transferId?: string
        start?: number
        end?: number
      }
      if (message.type === 'rpc' && message.method === 'media.stat') {
        ws.send(
          JSON.stringify({
            type: 'rpc-result',
            id: message.id,
            ok: true,
            result: { kind: 'file', size: 8, mime: 'application/octet-stream', name: 'a.bin' }
          })
        )
      } else if (message.type === 'rpc') {
        ws.send(
          JSON.stringify({ type: 'rpc-result', id: message.id, ok: true, result: { ok: true } })
        )
      } else if (message.type === 'media-open' && message.transferId) {
        const length = (message.end ?? 0) - (message.start ?? 0)
        ws.send(encodeMediaFrame(1, message.transferId, Buffer.alloc(length, 7)))
        ws.send(encodeMediaFrame(2, message.transferId))
      }
    })

    const nodeId = await registered
    expect(nodeId).toBe(issued.nodeId)

    const nodes = await authed('/api/nodes')
    const listed = (await nodes.json()) as {
      nodes: Array<{ id: string; online: boolean; name: string }>
    }
    expect(listed.nodes.find((node) => node.id === nodeId)?.online).toBe(true)
    expect(listed.nodes.find((node) => node.id === nodeId)?.name).toBe('客厅电脑')

    const rpc = await authed(`/api/nodes/${nodeId}/rpc`, {
      method: 'POST',
      body: JSON.stringify({ method: 'status.get', params: {} })
    })
    expect(rpc.status).toBe(200)

    const media = await authed(`/api/nodes/${nodeId}/media?token=abc`, {
      headers: { Range: 'bytes=0-3' }
    })
    expect(media.status).toBe(206)
    const bytes = Buffer.from(await media.arrayBuffer())
    expect(bytes).toEqual(Buffer.alloc(4, 7))

    ws.close()
  })
})
