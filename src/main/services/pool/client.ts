/**
 * dym-pool 服务端的 HTTP 客户端。接口说明见 dym-pool 仓库的 README。
 * 只做请求和错误转换，不读设置、不碰本地文件。
 */

import { net } from 'electron'

export const POOL_ORIGIN = 'https://pool.hyperdevx.com'
const API = `${POOL_ORIGIN}/api/v1`
const TIMEOUT_MS = 30_000

/** 走 Chromium 网络栈（net.fetch），跟随系统代理；直连 Cloudflare 在国内经常不稳 */
export const poolFetch = (url: string, init?: RequestInit): Promise<Response> =>
  net.fetch(url, init)

/** 服务端返回的错误码，例如 not_found、insufficient_credits、already_exists */
export class PoolError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(POOL_ERROR_TEXT[code] ?? `共享池返回错误：${code}（HTTP ${status}）`)
  }
}

const POOL_ERROR_TEXT: Record<string, string> = {
  unauthorized: '共享池登录已失效，请重新登录',
  invalid_credentials: '邮箱或密码不对',
  invalid_email: '邮箱格式不对',
  invalid_password: '密码长度需要 8 到 128 位',
  email_taken: '这个邮箱已经注册过，请直接登录',
  code_invalid: '验证码不对或已过期',
  rate_limited: '操作太频繁，请稍后再试',
  insufficient_credits: '共享池额度不足，先上传作品赚额度'
}

export interface PoolFile {
  name: string
  size: number
  contentType: string
}

export interface PoolUpload {
  name: string
  method: string
  url: string
  headers: Record<string, string>
}

export interface PoolProfile {
  nickname?: string
  signature?: string
  avatar?: string
  uid?: string
  shortId?: string
  uniqueId?: string
  followerCount?: number
  followingCount?: number
  totalFavorited?: number
  awemeCount?: number
}

export interface PoolPost {
  itemId: string
  /** 发布时间，Unix 秒 */
  createTime: number
  awemeType?: number
  desc?: string
  descRaw?: string
  caption?: string
}

async function request<T>(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
  timeoutMs = TIMEOUT_MS
): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await poolFetch(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    const timeout = (error as Error).name === 'TimeoutError'
    throw new Error(
      timeout ? '连接共享池超时，请检查网络或代理后重试' : '连不上共享池，请检查网络或代理后重试',
      {
        cause: error
      }
    )
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok)
    throw new PoolError(res.status, typeof json.error === 'string' ? json.error : 'http_error')
  return json as T
}

export const poolApi = {
  sendCode: (email: string) => request<{ ok: true }>('POST', '/auth/send-code', null, { email }),
  register: (email: string, password: string, code: string) =>
    request<{ token: string }>('POST', '/auth/register', null, { email, password, code }),
  login: (email: string, password: string) =>
    request<{ token: string }>('POST', '/auth/login', null, { email, password }),
  me: (token: string) =>
    request<{ id: number; email: string; credits: number; uploads: number }>('GET', '/me', token),

  requestUpload: (token: string, platform: string, itemId: string, files: PoolFile[]) =>
    request<{ uploads: PoolUpload[] }>('POST', '/uploads/request', token, {
      platform,
      itemId,
      files
    }),
  completeUpload: (token: string, platform: string, itemId: string) =>
    request<{ ok: true; credits: number }>('POST', '/uploads/complete', token, {
      platform,
      itemId
    }),
  /** 一次查多个作品（最多 500 个）是否在池里，不扣分 */
  lookup: (token: string, platform: string, itemIds: string[], timeoutMs: number) =>
    request<{ items: { itemId: string }[] }>(
      'POST',
      '/items/lookup',
      token,
      { platform, itemIds },
      timeoutMs
    ),
  /** 池里没有返回 404 not_found（不扣分）；额度不足返回 402 */
  download: (token: string, platform: string, itemId: string) =>
    request<{ files: { name: string; size: number; url: string }[]; credits: number }>(
      'POST',
      `/items/${platform}/${itemId}/download`,
      token
    ),

  putProfile: (token: string, platform: string, authorId: string, profile: PoolProfile) =>
    request<{ ok: true }>('PUT', `/authors/${platform}/${authorId}`, token, { profile }),
  putPosts: (
    token: string,
    platform: string,
    authorId: string,
    posts: PoolPost[],
    flags: { fromStart: boolean; reachedEnd: boolean }
  ) =>
    request<{ ok: true }>('POST', `/authors/${platform}/${authorId}/posts`, token, {
      posts,
      ...flags
    })
}
