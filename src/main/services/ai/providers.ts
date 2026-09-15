import { randomUUID } from 'crypto'
import { getDatabase, getSetting, setSetting } from '../../database'
import {
  AI_PROTOCOLS,
  type AiProtocol,
  type AiProviderInput,
  type AiProviderView,
  type AiReasoningEffort,
  type CodexAuthStatus,
  type OpenCodeCliKey
} from '../../../shared/ai'
import type { AiClient, AiModelInfo, ResolvedProvider } from './types'
import { createAiClient, CODEX_BASE_URL } from './clients'
import { openSecret, sealSecret } from './secret'
import { pickOpenCodeCliKey } from './opencode-auth'
import {
  cancelCodexLogin,
  hasCliAuth,
  importFromCli,
  loginWithBrowser,
  parseCodexCredential,
  type CodexCredential
} from './codex-auth'

interface ProviderRow {
  id: string
  name: string
  protocol: string
  base_url: string
  model: string
  credential: string | null
  credential_label: string | null
  reasoning_effort: string | null
  is_default: number
  created_at: number
  updated_at: number
}

const VALID_PROTOCOLS = new Set<string>(AI_PROTOCOLS.map((p) => p.value))
const VALID_EFFORTS = new Set<string>(['none', 'minimal', 'low', 'medium', 'high'])

function toView(row: ProviderRow): AiProviderView {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as AiProtocol,
    baseUrl: row.base_url,
    model: row.model,
    hasCredential: !!row.credential,
    credentialLabel: row.credential_label,
    reasoningEffort: (row.reasoning_effort as AiReasoningEffort | null) ?? null,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toResolved(row: ProviderRow): ResolvedProvider {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as AiProtocol,
    baseUrl: row.protocol === 'codex' ? CODEX_BASE_URL : row.base_url,
    model: row.model,
    credential: openSecret(row.credential),
    reasoningEffort: (row.reasoning_effort as AiReasoningEffort | null) ?? null
  }
}

function getRow(id: string): ProviderRow | undefined {
  return getDatabase().prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as
    | ProviderRow
    | undefined
}

// ==================== 查询 ====================

export function listProviders(): AiProviderView[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM ai_providers ORDER BY is_default DESC, created_at ASC')
    .all() as ProviderRow[]
  return rows.map(toView)
}

export function getProviderView(id: string): AiProviderView | null {
  const row = getRow(id)
  return row ? toView(row) : null
}

export function getDefaultProviderId(): string | null {
  const row = getDatabase()
    .prepare('SELECT id FROM ai_providers WHERE is_default = 1 LIMIT 1')
    .get() as { id: string } | undefined
  if (row) return row.id
  // 没有显式默认时取最早创建的那个，免得用户只配了一个还要再点一下「设为默认」
  const first = getDatabase()
    .prepare('SELECT id FROM ai_providers ORDER BY created_at ASC LIMIT 1')
    .get() as { id: string } | undefined
  return first?.id ?? null
}

/** 供推理使用：解密凭据。找不到时抛出可读错误 */
export function resolveProvider(id?: string | null): ResolvedProvider {
  const targetId = id ?? getDefaultProviderId()
  if (!targetId) throw new Error('尚未配置 AI 提供方，请先到「设置 → AI 提供方」添加')
  const row = getRow(targetId)
  if (!row) throw new Error(`AI 提供方不存在（${targetId}），请重新选择`)
  if (!row.model.trim()) throw new Error(`提供方「${row.name}」未填写模型`)
  const resolved = toResolved(row)
  if (row.protocol === 'codex' && !parseCodexCredential(resolved.credential)) {
    throw new Error(`提供方「${row.name}」尚未登录 ChatGPT`)
  }
  return resolved
}

export function createClientFor(id?: string | null): AiClient {
  return createAiClient(resolveProvider(id), { persistCredential: persistCredential })
}

// ==================== 写入 ====================

function validateInput(input: AiProviderInput): void {
  if (!input.name?.trim()) throw new Error('请填写提供方名称')
  if (!VALID_PROTOCOLS.has(input.protocol)) throw new Error(`未知协议：${input.protocol}`)
  if (input.protocol !== 'codex' && !input.baseUrl?.trim()) throw new Error('请填写 API 地址')
  if (input.reasoningEffort && !VALID_EFFORTS.has(input.reasoningEffort)) {
    throw new Error(`未知推理深度：${input.reasoningEffort}`)
  }
}

export function saveProvider(input: AiProviderInput): AiProviderView {
  validateInput(input)
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const existing = input.id ? getRow(input.id) : undefined
  const id = existing?.id ?? input.id ?? randomUUID()
  const baseUrl = input.protocol === 'codex' ? CODEX_BASE_URL : input.baseUrl.trim()

  if (existing) {
    // 换协议后旧凭据（比如 codex 的 OAuth）对新协议没意义，直接丢弃
    const protocolChanged = existing.protocol !== input.protocol
    // apiKey 为 undefined 表示不动已存凭据；空串表示清空
    const credential = input.apiKey
      ? sealSecret(input.apiKey)
      : input.apiKey === undefined && !protocolChanged
        ? existing.credential
        : null
    db.prepare(
      `UPDATE ai_providers SET name = ?, protocol = ?, base_url = ?, model = ?, credential = ?,
         credential_label = ?, reasoning_effort = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.name.trim(),
      input.protocol,
      baseUrl,
      input.model.trim(),
      credential,
      protocolChanged ? null : existing.credential_label,
      input.reasoningEffort ?? null,
      now,
      id
    )
  } else {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM ai_providers').get() as { c: number }).c
    db.prepare(
      `INSERT INTO ai_providers (id, name, protocol, base_url, model, credential, credential_label,
         reasoning_effort, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
    ).run(
      id,
      input.name.trim(),
      input.protocol,
      baseUrl,
      input.model.trim(),
      input.apiKey ? sealSecret(input.apiKey) : null,
      input.reasoningEffort ?? null,
      count === 0 ? 1 : 0,
      now,
      now
    )
  }
  return toView(getRow(id)!)
}

export function deleteProvider(id: string): void {
  const db = getDatabase()
  const row = getRow(id)
  if (!row) return
  db.transaction(() => {
    db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id)
    if (row.is_default === 1) {
      const next = db
        .prepare('SELECT id FROM ai_providers ORDER BY created_at ASC LIMIT 1')
        .get() as { id: string } | undefined
      if (next) db.prepare('UPDATE ai_providers SET is_default = 1 WHERE id = ?').run(next.id)
    }
  })()
}

export function setDefaultProvider(id: string): void {
  const db = getDatabase()
  if (!getRow(id)) throw new Error('提供方不存在')
  db.transaction(() => {
    db.prepare('UPDATE ai_providers SET is_default = 0').run()
    db.prepare('UPDATE ai_providers SET is_default = 1 WHERE id = ?').run(id)
  })()
}

function persistCredential(id: string, credentialJson: string): void {
  const cred = parseCodexCredential(credentialJson)
  getDatabase()
    .prepare(
      `UPDATE ai_providers SET credential = ?, credential_label = ?, updated_at = strftime('%s','now') WHERE id = ?`
    )
    .run(sealSecret(credentialJson), cred?.email ?? null, id)
}

// ==================== 验证 / 模型列表 ====================

/** 以「草稿」形态验证：渲染端还没保存的表单也能测；apiKey 缺省时用已存的 */
function resolveDraft(input: AiProviderInput): ResolvedProvider {
  validateInput(input)
  const existing = input.id ? getRow(input.id) : undefined
  const credential =
    input.apiKey !== undefined && input.apiKey !== ''
      ? input.apiKey
      : existing
        ? openSecret(existing.credential)
        : ''
  return {
    id: existing?.id ?? input.id ?? 'draft',
    name: input.name,
    protocol: input.protocol,
    baseUrl: input.protocol === 'codex' ? CODEX_BASE_URL : input.baseUrl,
    model: input.model,
    credential,
    reasoningEffort: input.reasoningEffort ?? null
  }
}

export async function verifyProvider(
  input: AiProviderInput
): Promise<{ ok: true; message: string }> {
  const resolved = resolveDraft(input)
  if (!resolved.model.trim()) throw new Error('请先填写模型')
  if (resolved.protocol === 'codex' && !parseCodexCredential(resolved.credential)) {
    throw new Error('请先登录 ChatGPT')
  }
  const client = createAiClient(resolved, {
    persistCredential: (id, json) => {
      if (id !== 'draft') persistCredential(id, json)
    }
  })
  await client.verify()
  return { ok: true, message: `连接成功：${resolved.model}` }
}

export async function listProviderModels(input: AiProviderInput): Promise<AiModelInfo[] | null> {
  const resolved = resolveDraft(input)
  const client = createAiClient(resolved, {
    persistCredential: (id, json) => {
      if (id !== 'draft') persistCredential(id, json)
    }
  })
  return client.listModels()
}

// ==================== Codex 登录 ====================

export function getCodexStatus(providerId: string): CodexAuthStatus {
  const row = getRow(providerId)
  const cred = row ? parseCodexCredential(openSecret(row.credential)) : null
  return {
    loggedIn: !!cred,
    email: cred?.email ?? row?.credential_label ?? null,
    accountId: cred?.account_id ?? null,
    expiresAt: cred?.expires_at ?? null,
    cliAuthAvailable: hasCliAuth()
  }
}

function ensureCodexProvider(providerId: string): ProviderRow {
  const row = getRow(providerId)
  if (!row) throw new Error('提供方不存在，请先保存')
  if (row.protocol !== 'codex') throw new Error('该提供方不是 ChatGPT 订阅（Codex）协议')
  return row
}

function storeCodexCredential(providerId: string, cred: CodexCredential): CodexAuthStatus {
  persistCredential(providerId, JSON.stringify(cred))
  return getCodexStatus(providerId)
}

export async function codexLogin(providerId: string): Promise<CodexAuthStatus> {
  ensureCodexProvider(providerId)
  const cred = await loginWithBrowser()
  return storeCodexCredential(providerId, cred)
}

export function codexCancelLogin(): void {
  cancelCodexLogin()
}

export function codexImportFromCli(providerId: string): CodexAuthStatus {
  ensureCodexProvider(providerId)
  return storeCodexCredential(providerId, importFromCli())
}

export function codexLogout(providerId: string): CodexAuthStatus {
  ensureCodexProvider(providerId)
  getDatabase()
    .prepare(
      `UPDATE ai_providers SET credential = NULL, credential_label = NULL, updated_at = strftime('%s','now') WHERE id = ?`
    )
    .run(providerId)
  return getCodexStatus(providerId)
}

// ==================== OpenCode CLI 导入 ====================

/** 本机 OpenCode CLI 里与该地址匹配的 API Key；没有返回 null */
export function opencodeCliKey(baseUrl: string): OpenCodeCliKey | null {
  return pickOpenCodeCliKey(baseUrl || '')
}

// ==================== 旧设置迁移 ====================

const LEGACY_MIGRATED_KEY = 'ai_providers_migrated'

/**
 * 把 2.x 的 grok_api_key / grok_api_url / analysis_model 三个散落设置收成一条提供方记录。
 * 只在还没迁移过、且旧设置里确实填了东西时执行；执行后旧键删除。
 */
export function migrateLegacyProviderSettings(): void {
  if (getSetting(LEGACY_MIGRATED_KEY) === '1') return
  const db = getDatabase()
  const apiKey = getSetting('grok_api_key') || ''
  const apiUrl = getSetting('grok_api_url') || ''
  const model = getSetting('analysis_model') || ''
  const count = (db.prepare('SELECT COUNT(*) AS c FROM ai_providers').get() as { c: number }).c

  if (count === 0 && (apiKey || model)) {
    const isGrok = !apiUrl || /x\.ai/i.test(apiUrl)
    saveProvider({
      name: isGrok ? 'xAI Grok（迁移自旧设置）' : 'OpenAI 兼容（迁移自旧设置）',
      protocol: 'openai-chat',
      baseUrl: apiUrl || 'https://api.x.ai/v1',
      model: model || 'grok-4-fast',
      apiKey
    })
    console.log('[AI] 已把旧的 Grok 设置迁移为 AI 提供方')
  }
  db.prepare(
    `DELETE FROM settings WHERE key IN ('grok_api_key', 'grok_api_url', 'analysis_model')`
  ).run()
  setSetting(LEGACY_MIGRATED_KEY, '1')
}
