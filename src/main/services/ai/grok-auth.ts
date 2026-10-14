import { createHash, randomBytes } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { shell } from 'electron'
import { callbackPage } from './codex-auth'

/**
 * Grok 订阅（SuperGrok / X Premium）登录：xAI 给 Grok CLI 与第三方工具共用的公开 OAuth 客户端，
 * PKCE + 本机回调。回调端口不限，优先 56121，被占用就随机。
 */
const CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
const AUTHORIZE_URL = 'https://auth.x.ai/oauth2/authorize'
const TOKEN_URL = 'https://auth.x.ai/oauth2/token'
const SCOPE = 'openid profile email offline_access grok-cli:access api:access'
const CALLBACK_HOST = '127.0.0.1'
const CALLBACK_PORT = 56121
const CALLBACK_PATH = '/callback'
const LOGIN_TIMEOUT_MS = 5 * 60_000
/** 距过期不到这个时间就先刷新 */
const REFRESH_SKEW_SEC = 120

export interface GrokCredential {
  access_token: string
  refresh_token: string
  id_token?: string
  email: string | null
  /** 秒级时间戳 */
  expires_at: number
}

function jwtPayload(token: string | undefined): Record<string, unknown> {
  const part = token?.split('.')[1]
  if (!part) return {}
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function parseGrokCredential(raw: string | null | undefined): GrokCredential | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<GrokCredential>
    if (!parsed.access_token || !parsed.refresh_token) return null
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      id_token: parsed.id_token,
      email: parsed.email ?? null,
      expires_at: Number(parsed.expires_at) || 0
    }
  } catch {
    return null
  }
}

async function postToken(form: Record<string, string>): Promise<GrokCredential> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
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
    throw new Error(`xAI 令牌接口返回 ${response.status}：${detail}`)
  }
  const tokens = JSON.parse(text) as {
    access_token?: string
    refresh_token?: string
    id_token?: string
    expires_in?: number
  }
  if (!tokens.access_token) throw new Error('xAI 令牌接口没有返回 access_token')
  const refreshToken = tokens.refresh_token ?? form.refresh_token
  if (!refreshToken) throw new Error('xAI 令牌接口没有返回 refresh_token')
  const exp = jwtPayload(tokens.access_token).exp
  const email = jwtPayload(tokens.id_token).email
  return {
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    id_token: tokens.id_token,
    email: typeof email === 'string' ? email : null,
    expires_at:
      typeof exp === 'number'
        ? exp
        : Math.floor(Date.now() / 1000) + (Number(tokens.expires_in) || 1800)
  }
}

const refreshing = new Map<string, Promise<GrokCredential>>()

/** 保证凭据未过期；刷新会轮换 refresh_token，必须经 persist 回写。同一凭据并发只刷新一次 */
export async function ensureFreshGrokCredential(
  credential: GrokCredential,
  persist: (next: GrokCredential) => void
): Promise<GrokCredential> {
  const now = Math.floor(Date.now() / 1000)
  if (credential.expires_at - REFRESH_SKEW_SEC > now) return credential
  const key = credential.refresh_token
  let pending = refreshing.get(key)
  if (!pending) {
    pending = postToken({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: credential.refresh_token
    })
      .then((next) => {
        const merged: GrokCredential = { ...next, email: next.email ?? credential.email }
        persist(merged)
        return merged
      })
      .finally(() => refreshing.delete(key))
    refreshing.set(key, pending)
  }
  return pending
}

// ==================== 浏览器登录 ====================

let activeLogin: { cancel: (reason: Error) => void } | null = null

export function cancelGrokLogin(): void {
  activeLogin?.cancel(new Error('登录已取消'))
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, CALLBACK_HOST, () => {
      server.off('error', reject)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

export async function loginGrokWithBrowser(): Promise<GrokCredential> {
  if (activeLogin) activeLogin.cancel(new Error('已开始新的登录'))

  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('hex')

  let onRequest: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => {
    res.statusCode = 404
    res.end()
  }
  const server = createServer((req, res) => onRequest(req, res))
  let port: number
  try {
    port = await listen(server, CALLBACK_PORT)
  } catch {
    port = await listen(server, 0)
  }
  const redirectUri = `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`

  const authUrl = new URL(AUTHORIZE_URL)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', randomBytes(16).toString('hex'))
  authUrl.searchParams.set('plan', 'generic')
  authUrl.searchParams.set('referrer', 'dym')

  const code = await new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      activeLogin = null
      fn()
    }
    const fail = (error: Error): void => finish(() => reject(error))
    const timer = setTimeout(
      () => fail(new Error('登录超时（5 分钟内未完成授权）')),
      LOGIN_TIMEOUT_MS
    )
    activeLogin = { cancel: fail }

    onRequest = (req, res) => {
      const url = new URL(req.url ?? '/', redirectUri)
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (url.pathname !== CALLBACK_PATH) {
        res.statusCode = 404
        res.end(callbackPage('地址不对', '请回到应用重新点击登录。'))
        return
      }
      const error = url.searchParams.get('error')
      if (error) {
        const detail = url.searchParams.get('error_description') ?? error
        res.statusCode = 400
        res.end(callbackPage('授权失败', detail))
        fail(new Error(`授权失败：${detail}`))
        return
      }
      const authCode = url.searchParams.get('code')
      if (url.searchParams.get('state') !== state || !authCode) {
        res.statusCode = 400
        res.end(callbackPage('回调参数不对', '请回到应用重新登录。'))
        return
      }
      res.statusCode = 200
      res.end(callbackPage('登录成功', '可以关闭此页面，回到应用继续。'))
      finish(() => resolve(authCode))
    }

    shell.openExternal(authUrl.toString()).catch((err: Error) => {
      fail(new Error(`无法打开浏览器：${err.message}`))
    })
  })

  return postToken({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri
  })
}
