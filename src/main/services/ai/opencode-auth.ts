import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { OpenCodeCliKey } from '../../../shared/ai'

/** OpenCode CLI 的凭据文件：$XDG_DATA_HOME/opencode/auth.json，默认 ~/.local/share/opencode/auth.json（各平台一致） */
export function opencodeCliAuthPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return join(dataHome, 'opencode', 'auth.json')
}

const ENTRIES: OpenCodeCliKey['entry'][] = ['opencode', 'opencode-go']

/**
 * 读取本机 OpenCode `/connect` 保存的 Zen / Go API Key。
 * 文件不存在或格式不对都返回空数组，由调用方决定提示什么。
 */
export function readOpenCodeCliKeys(): OpenCodeCliKey[] {
  const path = opencodeCliAuthPath()
  if (!existsSync(path)) return []
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  if (!raw || typeof raw !== 'object') return []
  const store = raw as Record<string, { type?: string; key?: string } | undefined>
  const result: OpenCodeCliKey[] = []
  for (const entry of ENTRIES) {
    const item = store[entry]
    if (item?.type === 'api' && typeof item.key === 'string' && item.key.trim()) {
      result.push({ entry, key: item.key.trim() })
    }
  }
  return result
}

/**
 * 按地址挑最匹配的 Key：Go 地址优先 opencode-go，否则优先 opencode；
 * 两者共用同一个账号体系，只有一边有 Key 时也照用。
 */
export function pickOpenCodeCliKey(baseUrl: string): OpenCodeCliKey | null {
  const keys = readOpenCodeCliKeys()
  if (keys.length === 0) return null
  const preferred: OpenCodeCliKey['entry'] = /\/zen\/go(\/|$)/i.test(baseUrl)
    ? 'opencode-go'
    : 'opencode'
  return keys.find((k) => k.entry === preferred) ?? keys[0]
}
