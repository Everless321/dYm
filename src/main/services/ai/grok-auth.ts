import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/** Grok CLI 浏览器登录（SuperGrok 订阅）在 auth.json 里的条目名 */
const SIGN_IN_ENTRY = 'https://accounts.x.ai/sign-in'

/** Grok CLI 的配置目录：$GROK_HOME，默认 ~/.grok（各平台一致） */
export function grokCliAuthPath(): string {
  return join(process.env.GROK_HOME || join(homedir(), '.grok'), 'auth.json')
}

/** 从 auth.json 内容里取会话令牌；格式不对返回 null */
export function parseGrokCliToken(raw: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const entry = (parsed as Record<string, { key?: unknown } | undefined>)[SIGN_IN_ENTRY]
  return typeof entry?.key === 'string' && entry.key.trim() ? entry.key.trim() : null
}

/**
 * 读取本机 `grok login` 保存的会话令牌。每次请求现读：令牌 7 天过期，
 * 用户在终端重新登录后不用回 dYm 再导入一遍。
 */
export function readGrokCliToken(): string | null {
  const path = grokCliAuthPath()
  if (!existsSync(path)) return null
  try {
    return parseGrokCliToken(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
