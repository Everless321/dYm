import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import { createServer as createTcpServer, type Server as TcpServer } from 'net'
import { describeNetworkError } from './network-error'

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return describeNetworkError(error)
  }
  throw new Error('应当失败')
}

let slow: Server
let resetter: TcpServer
let slowPort = 0
let resetPort = 0

beforeAll(async () => {
  // 迟迟不回响应
  slow = createServer(() => undefined)
  await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r))
  slowPort = (slow.address() as { port: number }).port
  // 收到请求就把连接硬掐断
  resetter = createTcpServer((socket) => socket.once('data', () => socket.resetAndDestroy()))
  await new Promise<void>((r) => resetter.listen(0, '127.0.0.1', r))
  resetPort = (resetter.address() as { port: number }).port
})

afterAll(() => {
  slow.closeAllConnections()
  slow.close()
  resetter.close()
})

describe('describeNetworkError', () => {
  it('连接被拒绝', async () => {
    // 先占一个端口再关掉，保证这个端口上没人在听（1 号端口会被 fetch 当成 bad port 直接拒绝）
    const probe = createTcpServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const closedPort = (probe.address() as { port: number }).port
    await new Promise<void>((r) => probe.close(() => r()))
    const text = await failureOf(fetch(`http://127.0.0.1:${closedPort}/`))
    expect(text).toContain('连接被拒绝')
    expect(text).toContain('ECONNREFUSED')
  })

  it('连接被对方重置 / 中途断开', async () => {
    const text = await failureOf(fetch(`http://127.0.0.1:${resetPort}/`))
    expect(text).toMatch(/连接被重置|连接意外断开/)
  })

  it('超时', async () => {
    const text = await failureOf(
      fetch(`http://127.0.0.1:${slowPort}/`, { signal: AbortSignal.timeout(200) })
    )
    expect(text).toContain('超时')
  })

  it('DNS 解析失败（按 Node 的错误结构构造：本机走代理的假 IP DNS，没法真实复现）', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), {
      code: 'ENOTFOUND'
    })
    const text = describeNetworkError(new TypeError('fetch failed', { cause }))
    expect(text).toBe('DNS 解析失败（ENOTFOUND）')
  })

  it('多个地址都连不上时（AggregateError）也能取到原因', () => {
    const errors = [
      Object.assign(new Error('connect ETIMEDOUT 1.1.1.1:443'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('connect ETIMEDOUT [::1]:443'), { code: 'ETIMEDOUT' })
    ]
    const cause = Object.assign(new AggregateError(errors), { code: 'ETIMEDOUT' })
    expect(describeNetworkError(new TypeError('fetch failed', { cause }))).toContain('连接超时')
  })

  it('普通错误原样返回', () => {
    expect(describeNetworkError(new Error('HTTP 403 AccessDenied'))).toBe('HTTP 403 AccessDenied')
  })
})
