import { app } from 'electron'
import { existsSync } from 'fs'
import { hostname, networkInterfaces } from 'os'
import { join } from 'path'
import { createPanelServer, type RunningPanel } from '../../../panel/server'
import { randomSecret } from '../../../panel/store'
import { getSetting, setSetting } from '../../database'
import { startPanelAgent, type AgentLinkState, type PanelAgent } from './agent'

export interface PanelRuntimeStatus {
  embedStarted: boolean
  port: number
  host: string
  urls: string[]
  adminToken: string
  agent: 'off' | AgentLinkState
  agentError: string | null
}

let panel: RunningPanel | null = null
let agent: PanelAgent | null = null
let agentState: PanelRuntimeStatus['agent'] = 'off'
let agentError: string | null = null
let chain: Promise<void> = Promise.resolve()

export function getPanelRuntimeStatus(): PanelRuntimeStatus {
  const port = panel?.port ?? readPort()
  const host = panel?.host ?? (lanEnabled() ? '0.0.0.0' : '127.0.0.1')
  return {
    embedStarted: Boolean(panel),
    port,
    host,
    urls: panel ? listenUrls(port, host === '0.0.0.0') : [],
    adminToken: getSetting('panel_admin_token') ?? '',
    agent: agentState,
    agentError
  }
}

export function applyPanelRuntime(): Promise<PanelRuntimeStatus> {
  chain = chain.then(startFromSettings, startFromSettings)
  return chain.then(() => getPanelRuntimeStatus())
}

export async function stopPanelRuntime(): Promise<void> {
  chain = chain.then(
    async () => {
      stopAgent()
      await stopEmbed()
    },
    async () => {
      stopAgent()
      await stopEmbed()
    }
  )
  await chain
}

export async function issueLocalKey(): Promise<{ apiKey: string; url: string }> {
  if (getSetting('panel_embed_enabled') !== 'true') {
    throw new Error('请先启用内置管理端并保存')
  }
  await applyPanelRuntime()
  if (!panel) throw new Error('内置管理端没有启动')
  const issued = panel.issueKey(`本机-${hostname()}`)
  const url = `http://127.0.0.1:${panel.port}`
  setSetting('panel_node_enabled', 'true')
  setSetting('panel_node_url', url)
  setSetting('panel_node_api_key', issued.key)
  if (!(getSetting('panel_node_name') || '').trim()) {
    setSetting('panel_node_name', hostname())
  }
  await applyPanelRuntime()
  return { apiKey: issued.key, url }
}

async function startFromSettings(): Promise<void> {
  stopAgent()
  await stopEmbed()
  if (getSetting('panel_embed_enabled') === 'true') {
    await startEmbed()
  }
  if (getSetting('panel_node_enabled') === 'true') {
    startNode()
  }
}

async function startEmbed(): Promise<void> {
  let token = (getSetting('panel_admin_token') || '').trim()
  if (!token) {
    token = randomSecret(18)
    setSetting('panel_admin_token', token)
  }
  const host = lanEnabled() ? '0.0.0.0' : '127.0.0.1'
  panel = await createPanelServer({
    port: readPort(),
    host,
    dataDir: join(app.getPath('userData'), 'panel'),
    publicDir: resolvePanelPublicDir(),
    adminToken: token
  })
  console.log('[Panel] 管理端已启动:', listenUrls(panel.port, host === '0.0.0.0').join(', '))
}

function startNode(): void {
  const url = (getSetting('panel_node_url') || '').trim()
  const apiKey = (getSetting('panel_node_api_key') || '').trim()
  if (!url || !apiKey) {
    agentState = 'error'
    agentError = '请填写管理端地址和 API Key'
    return
  }
  const name = (getSetting('panel_node_name') || '').trim() || hostname()
  try {
    agent = startPanelAgent({
      url,
      apiKey,
      name,
      version: app.getVersion(),
      onStatus: (state, error) => {
        agentState = state
        agentError = error
      }
    })
    agentState = 'connecting'
    agentError = null
  } catch (error) {
    agentState = 'error'
    agentError = (error as Error).message
  }
}

function stopAgent(): void {
  agent?.stop()
  agent = null
  agentState = 'off'
  agentError = null
}

async function stopEmbed(): Promise<void> {
  const current = panel
  panel = null
  if (!current) return
  await current.close()
}

function readPort(): number {
  const parsed = Number.parseInt(getSetting('panel_embed_port') || '', 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return 38600
  return parsed
}

function lanEnabled(): boolean {
  return getSetting('panel_embed_lan') === 'true'
}

function listenUrls(port: number, lan: boolean): string[] {
  const urls = [`http://127.0.0.1:${port}`]
  if (!lan) return urls
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) urls.push(`http://${entry.address}:${port}`)
    }
  }
  return urls
}

export function resolvePanelPublicDir(): string {
  const candidates = [
    join(process.cwd(), 'src/panel/public'),
    join(app.getAppPath(), 'src/panel/public'),
    join(process.resourcesPath, 'panel')
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir
  }
  return candidates[0]
}
