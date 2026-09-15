import { AiHttpError } from './types'

export const DEFAULT_TIMEOUT_MS = 120_000

/**
 * 规范化 API 基址：去掉末尾斜杠。
 * 只填主机端口（如 http://localhost:1234）的 OpenAI 兼容服务会补 /v1；已有路径的原样保留。
 */
export function normalizeBaseUrl(baseUrl: string, appendV1 = false): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!trimmed || !appendV1) return trimmed
  try {
    const u = new URL(trimmed)
    if (u.pathname === '' || u.pathname === '/') return `${trimmed}/v1`
  } catch {
    // 非法 URL 交给 fetch 报错
  }
  return trimmed
}

export function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (signal) signals.push(signal)
  return AbortSignal.any(signals)
}

/** 从错误响应体里抠出服务端的说明；不是 JSON 就截一段原文 */
export function describeErrorBody(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { message?: string; type?: string } | string
      message?: string
      detail?: string
    }
    if (typeof parsed.error === 'string') return parsed.error
    if (parsed.error?.message) return parsed.error.message
    if (parsed.message) return parsed.message
    if (parsed.detail) return parsed.detail
  } catch {
    // 非 JSON（HTML 错误页等）
  }
  return trimmed
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 200)
}

export async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init
  const response = await fetch(url, {
    ...rest,
    signal: combineSignals(signal ?? undefined, timeoutMs)
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const detail = describeErrorBody(body)
    throw new AiHttpError(
      response.status,
      `HTTP ${response.status} ${response.statusText}${detail ? `：${detail}` : ''}`,
      body
    )
  }
  return response
}

export function bearerHeaders(
  apiKey: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  // Ollama / LM Studio 无需鉴权，发空 Bearer 反而可能被拒
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`
  return headers
}

export function toDataUrl(mime: string, data: Buffer): string {
  return `data:${mime};base64,${data.toString('base64')}`
}
