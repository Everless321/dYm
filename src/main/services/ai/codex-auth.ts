import { createHash, randomBytes } from 'crypto'
import { createServer, type Server } from 'http'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { shell } from 'electron'

/**
 * ChatGPT 订阅（Codex）登录：与 openai/codex CLI 相同的 OAuth PKCE 流程。
 * 回调地址在 OpenAI 侧是固定注册的 http://localhost:1455/auth/callback，端口不能改。
 */
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CALLBACK_PORT = 1455
const CALLBACK_PATH = '/auth/callback'
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`
const SCOPE = 'openid profile email offline_access'
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'
const LOGIN_TIMEOUT_MS = 5 * 60_000
/** 距过期不到这个时间就先刷新，避免请求发到一半 token 失效 */
const REFRESH_SKEW_SEC = 120

export const CODEX_ORIGINATOR = 'dym-douyin-manager'

export interface CodexCredential {
  access_token: string
  refresh_token: string
  id_token?: string
  account_id: string
  email: string | null
  /** 秒级时间戳 */
  expires_at: number
}

export function parseCodexCredential(raw: string | null | undefined): CodexCredential | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CodexCredential>
    if (!parsed.access_token || !parsed.refresh_token || !parsed.account_id) return null
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      id_token: parsed.id_token,
      account_id: parsed.account_id,
      email: parsed.email ?? null,
      expires_at: Number(parsed.expires_at) || jwtExp(parsed.access_token)
    }
  } catch {
    return null
  }
}

// ==================== JWT ====================

function jwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length < 2) return {}
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return {}
  }
}

function jwtExp(token: string): number {
  const exp = jwtPayload(token).exp
  return typeof exp === 'number' ? exp : 0
}

function accountIdOf(accessToken: string, fallback?: string): string {
  const claim = jwtPayload(accessToken)[JWT_CLAIM_PATH] as
    | { chatgpt_account_id?: string }
    | undefined
  return claim?.chatgpt_account_id ?? fallback ?? ''
}

function emailOf(idToken: string | undefined, accessToken: string): string | null {
  for (const token of [idToken, accessToken]) {
    if (!token) continue
    const payload = jwtPayload(token)
    if (typeof payload.email === 'string') return payload.email
    const claim = payload[JWT_CLAIM_PATH] as { email?: string } | undefined
    if (claim?.email) return claim.email
  }
  return null
}

function credentialFromTokens(tokens: {
  access_token: string
  refresh_token: string
  id_token?: string
  account_id?: string
  expires_in?: number
}): CodexCredential {
  const accountId = accountIdOf(tokens.access_token, tokens.account_id)
  if (!accountId) throw new Error('登录成功但没有拿到 ChatGPT 账号 ID，无法调用 Codex 后端')
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    account_id: accountId,
    email: emailOf(tokens.id_token, tokens.access_token),
    expires_at:
      jwtExp(tokens.access_token) ||
      Math.floor(Date.now() / 1000) + (Number(tokens.expires_in) || 1800)
  }
}

// ==================== 从 Codex CLI 导入 ====================

function cliAuthPath(): string {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json')
}

export function hasCliAuth(): boolean {
  return existsSync(cliAuthPath())
}

/** 读取本机 `codex login` 留下的登录态；API Key 模式的登录态不适用于订阅后端 */
export function importFromCli(): CodexCredential {
  const path = cliAuthPath()
  if (!existsSync(path)) throw new Error(`未找到 Codex CLI 登录文件：${path}`)
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    auth_mode?: string
    tokens?: {
      access_token?: string
      refresh_token?: string
      id_token?: string
      account_id?: string
    }
  }
  if (raw.auth_mode && raw.auth_mode !== 'chatgpt') {
    throw new Error(
      `Codex CLI 当前是 ${raw.auth_mode} 登录模式，需要用 ChatGPT 账号执行 codex login`
    )
  }
  const tokens = raw.tokens
  if (!tokens?.access_token || !tokens.refresh_token) {
    throw new Error('Codex CLI 登录文件里没有可用的令牌，请先执行 codex login')
  }
  return credentialFromTokens({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    account_id: tokens.account_id
  })
}

// ==================== 刷新 ====================

async function postToken(form: Record<string, string>): Promise<CodexCredential> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(60_000)
  })
  const text = await response.text()
  if (!response.ok) {
    let detail = text.slice(0, 200)
    try {
      const parsed = JSON.parse(text) as { error_description?: string; error?: string }
      detail = parsed.error_description ?? parsed.error ?? detail
    } catch {
      /* 非 JSON */
    }
    throw new Error(`OAuth 令牌接口返回 ${response.status}：${detail}`)
  }
  const tokens = JSON.parse(text) as {
    access_token: string
    refresh_token?: string
    id_token?: string
    expires_in?: number
  }
  return credentialFromTokens({
    ...tokens,
    refresh_token: tokens.refresh_token ?? form.refresh_token
  })
}

const refreshing = new Map<string, Promise<CodexCredential>>()

/**
 * 保证凭据未过期；需要时刷新并通过 persist 回写（刷新会轮换 refresh_token，不落盘下次就废了）。
 * 同一账号并发请求只刷新一次。
 */
export async function ensureFreshCredential(
  credential: CodexCredential,
  persist: (next: CodexCredential) => void
): Promise<CodexCredential> {
  const now = Math.floor(Date.now() / 1000)
  if (credential.expires_at - REFRESH_SKEW_SEC > now) return credential
  const key = credential.account_id
  let pending = refreshing.get(key)
  if (!pending) {
    pending = postToken({
      grant_type: 'refresh_token',
      refresh_token: credential.refresh_token,
      client_id: CLIENT_ID
    })
      .then((next) => {
        const merged: CodexCredential = { ...next, email: next.email ?? credential.email }
        persist(merged)
        return merged
      })
      .finally(() => refreshing.delete(key))
    refreshing.set(key, pending)
  }
  return pending
}

// ==================== 浏览器登录 ====================

let activeLogin: { server: Server; cancel: (reason: Error) => void } | null = null

export function cancelCodexLogin(): void {
  activeLogin?.cancel(new Error('登录已取消'))
}

function html(title: string, body: string): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b0b0c;color:#eee}
main{text-align:center;max-width:420px}h1{font-size:20px}p{color:#aaa}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`
}

/**
 * 打开系统浏览器完成 ChatGPT 授权，本地起 1455 端口接回调。
 * 同时绑定 127.0.0.1 与 ::1：浏览器解析 localhost 在 Windows 上常常先走 IPv6。
 */
export async function loginWithBrowser(): Promise<CodexCredential> {
  if (activeLogin) activeLogin.cancel(new Error('已开始新的登录'))

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')

  const authUrl = new URL(AUTHORIZE_URL)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('id_token_add_organizations', 'true')
  authUrl.searchParams.set('codex_cli_simplified_flow', 'true')
  authUrl.searchParams.set('originator', CODEX_ORIGINATOR)

  const code = await new Promise<string>((resolve, reject) => {
    let settled = false
    const servers: Server[] = []
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const s of servers) s.close()
      activeLogin = null
      fn()
    }
    const fail = (error: Error): void => finish(() => reject(error))
    const timer = setTimeout(
      () => fail(new Error('登录超时（5 分钟内未完成授权）')),
      LOGIN_TIMEOUT_MS
    )

    const handler = (
      req: import('http').IncomingMessage,
      res: import('http').ServerResponse
    ): void => {
      const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`)
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (url.pathname !== CALLBACK_PATH) {
        res.statusCode = 404
        res.end(html('地址不对', '请回到应用重新点击登录。'))
        return
      }
      const error = url.searchParams.get('error')
      if (error) {
        res.statusCode = 400
        res.end(html('授权失败', url.searchParams.get('error_description') ?? error))
        fail(new Error(`授权失败：${url.searchParams.get('error_description') ?? error}`))
        return
      }
      if (url.searchParams.get('state') !== state) {
        res.statusCode = 400
        res.end(html('状态校验失败', '请回到应用重新登录。'))
        return
      }
      const authCode = url.searchParams.get('code')
      if (!authCode) {
        res.statusCode = 400
        res.end(html('缺少授权码', '请回到应用重新登录。'))
        return
      }
      res.statusCode = 200
      res.end(html('登录成功', '可以关闭此页面，回到应用继续。'))
      finish(() => resolve(authCode))
    }

    const listen = (host: string, required: boolean): void => {
      const server = createServer(handler)
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (!required) return
        fail(
          new Error(
            err.code === 'EADDRINUSE'
              ? `本机 ${CALLBACK_PORT} 端口被占用（可能是 Codex CLI 正在登录），请关闭后重试`
              : `无法启动登录回调服务：${err.message}`
          )
        )
      })
      server.listen(CALLBACK_PORT, host)
      servers.push(server)
    }
    listen('127.0.0.1', true)
    listen('::1', false)

    activeLogin = { server: servers[0], cancel: fail }

    servers[0].once('listening', () => {
      shell.openExternal(authUrl.toString()).catch((err: Error) => {
        fail(new Error(`无法打开浏览器：${err.message}`))
      })
    })
  })

  return postToken({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI
  })
}
