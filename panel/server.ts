import { createServer } from 'http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import next from 'next'
import { createPanelGateway } from '../src/panel/server'
import { randomSecret } from '../src/panel/store'

function dataDir(): string {
  return process.env.PANEL_DATA?.trim() || join(homedir(), '.dym-panel')
}

function adminToken(dir: string): string {
  const fromEnv = process.env.PANEL_ADMIN_TOKEN?.trim()
  if (fromEnv) return fromEnv
  const file = join(dir, 'admin-token.txt')
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim()
    if (saved) return saved
  }
  const token = randomSecret(18)
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, `${token}\n`, { mode: 0o600 })
  console.log(`已生成管理员口令：${token}`)
  console.log(`保存在 ${file}`)
  return token
}

async function main(): Promise<void> {
  const dir = dataDir()
  const port = Number.parseInt(process.env.PANEL_PORT || '38600', 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PANEL_PORT 不正确')
  }
  const host = process.env.PANEL_HOST?.trim() || '0.0.0.0'
  const dev = process.env.NODE_ENV !== 'production'
  const app = next({ dev, dir: process.cwd(), hostname: host, port })
  await app.prepare()
  const handleNext = app.getRequestHandler()
  const upgradeNext = app.getUpgradeHandler()
  // Next 会在第一次请求时把自己的 upgrade 监听挂到同一台 HTTP 服务上，
  // 那样 /agent 也会被它碰到。先占住这个初始化，升级仍由下面的监听转发。
  const custom = app as unknown as {
    setupWebSocketHandler?: (server: { on: () => void }) => void
  }
  custom.setupWebSocketHandler?.({ on: () => undefined })

  const gateway = createPanelGateway({ dataDir: dir, adminToken: adminToken(dir) })
  const server = createServer((request, response) => {
    void gateway.handle(request, response).then(
      (handled) => {
        if (!handled && !response.writableEnded) void handleNext(request, response)
      },
      (error: unknown) => {
        if (response.headersSent || response.writableEnded) {
          if (!response.destroyed) response.destroy()
          return
        }
        const message = error instanceof Error ? error.message : '内部错误'
        const status =
          error &&
          typeof error === 'object' &&
          'status' in error &&
          typeof error.status === 'number'
            ? error.status
            : 502
        response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: message || '内部错误' }))
      }
    )
  })
  gateway.attach(server)
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (pathname === '/agent') return
    upgradeNext(request, socket, head)
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, host, () => resolveListen())
  })
  console.log(`dYm 管理端已启动：http://127.0.0.1:${port}`)
  if (dev)
    console.log(
      '当前是开发模式。部署前先在 panel 目录执行 npm run build，再用 NODE_ENV=production 启动。'
    )

  const shutdown = (): void => {
    void gateway.close().finally(() => {
      server.close(() => process.exit(0))
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main().catch((error: unknown) => {
  console.error('[Panel]', error instanceof Error ? error.message : error)
  process.exit(1)
})
