import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { createPanelServer } from './server'
import { randomSecret } from './store'

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

function publicDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.PANEL_PUBLIC,
    join(here, 'public'),
    join(process.cwd(), 'src/panel/public')
  ]
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, 'index.html'))) return dir
  }
  throw new Error('找不到管理端页面，请设置 PANEL_PUBLIC')
}

async function main(): Promise<void> {
  const dir = dataDir()
  const port = Number.parseInt(process.env.PANEL_PORT || '38600', 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PANEL_PORT 不正确')
  }
  const host = process.env.PANEL_HOST?.trim() || '0.0.0.0'
  const server = await createPanelServer({
    port,
    host,
    dataDir: dir,
    publicDir: publicDir(),
    adminToken: adminToken(dir)
  })
  console.log(`dYm 管理端已启动：http://127.0.0.1:${server.port}`)
  console.log('在各台 dYm 的系统设置里填写这个地址，并使用网页里签发的 API Key 注册。')
  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main().catch((error) => {
  console.error('[Panel]', error instanceof Error ? error.message : error)
  process.exit(1)
})
