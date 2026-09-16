import { randomUUID } from 'crypto'
import { getDatabase } from '../../../database'
import {
  ASR_PROTOCOLS,
  type AsrProtocol,
  type AsrProviderInput,
  type AsrProviderView
} from '../../../../shared/ai'
import { openSecret, sealSecret } from '../secret'
import { createAsrClient } from './clients'
import type { AsrClient, ResolvedAsrProvider } from './types'

interface AsrRow {
  id: string
  name: string
  protocol: string
  base_url: string
  model: string
  credential: string | null
  max_clip_seconds: number
  extra_form: string
  is_default: number
  created_at: number
  updated_at: number
}

const VALID_PROTOCOLS = new Set<string>(ASR_PROTOCOLS.map((p) => p.value))
const MIN_CLIP = 10
const MAX_CLIP = 1800

function parseExtraForm(json: string | undefined | null): Record<string, string> {
  try {
    const parsed = JSON.parse(json || '{}') as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && k.trim()) out[k.trim()] = v
    }
    return out
  } catch {
    return {}
  }
}

function toView(row: AsrRow): AsrProviderView {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as AsrProtocol,
    baseUrl: row.base_url,
    model: row.model,
    maxClipSeconds: row.max_clip_seconds,
    extraForm: parseExtraForm(row.extra_form),
    hasCredential: !!row.credential,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toResolved(row: AsrRow): ResolvedAsrProvider {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as AsrProtocol,
    baseUrl: row.base_url,
    model: row.model,
    credential: openSecret(row.credential),
    maxClipSeconds: row.max_clip_seconds,
    extraForm: parseExtraForm(row.extra_form)
  }
}

function getRow(id: string): AsrRow | undefined {
  return getDatabase().prepare('SELECT * FROM asr_providers WHERE id = ?').get(id) as
    | AsrRow
    | undefined
}

export function listAsrProviders(): AsrProviderView[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM asr_providers ORDER BY is_default DESC, created_at ASC')
    .all() as AsrRow[]
  return rows.map(toView)
}

export function getAsrProviderView(id: string): AsrProviderView | null {
  const row = getRow(id)
  return row ? toView(row) : null
}

export function getDefaultAsrProviderId(): string | null {
  const db = getDatabase()
  const row = db.prepare('SELECT id FROM asr_providers WHERE is_default = 1 LIMIT 1').get() as
    | { id: string }
    | undefined
  if (row) return row.id
  const first = db.prepare('SELECT id FROM asr_providers ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined
  return first?.id ?? null
}

/** 没配置转写提供方时返回 null（分析流程据此跳过转写，而不是报错） */
export function resolveAsrProvider(id?: string | null): ResolvedAsrProvider | null {
  const targetId = id ?? getDefaultAsrProviderId()
  if (!targetId) return null
  const row = getRow(targetId)
  if (!row) throw new Error(`转写提供方不存在（${targetId}），请重新选择`)
  if (!row.model.trim()) throw new Error(`转写提供方「${row.name}」未填写模型`)
  return toResolved(row)
}

export function createAsrClientFor(id?: string | null): AsrClient | null {
  const provider = resolveAsrProvider(id)
  return provider ? createAsrClient(provider) : null
}

function validateInput(input: AsrProviderInput): void {
  if (!input.name?.trim()) throw new Error('请填写提供方名称')
  if (!VALID_PROTOCOLS.has(input.protocol)) throw new Error(`未知转写协议：${input.protocol}`)
  if (!input.baseUrl?.trim()) throw new Error('请填写 API 地址')
  if (input.maxClipSeconds !== undefined) {
    const n = Number(input.maxClipSeconds)
    if (!Number.isInteger(n) || n < MIN_CLIP || n > MAX_CLIP) {
      throw new Error(`单段音频上限必须是 ${MIN_CLIP}-${MAX_CLIP} 之间的整数（秒）`)
    }
  }
}

export function saveAsrProvider(input: AsrProviderInput): AsrProviderView {
  validateInput(input)
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const existing = input.id ? getRow(input.id) : undefined
  const id = existing?.id ?? input.id ?? randomUUID()
  const extraForm = JSON.stringify(input.extraForm ?? {})
  const maxClip = input.maxClipSeconds ?? existing?.max_clip_seconds ?? 600

  if (existing) {
    const credential = input.apiKey
      ? sealSecret(input.apiKey)
      : input.apiKey === undefined
        ? existing.credential
        : null
    db.prepare(
      `UPDATE asr_providers SET name = ?, protocol = ?, base_url = ?, model = ?, credential = ?,
         max_clip_seconds = ?, extra_form = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.name.trim(),
      input.protocol,
      input.baseUrl.trim(),
      input.model.trim(),
      credential,
      maxClip,
      extraForm,
      now,
      id
    )
  } else {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM asr_providers').get() as { c: number }).c
    db.prepare(
      `INSERT INTO asr_providers (id, name, protocol, base_url, model, credential, max_clip_seconds,
         extra_form, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name.trim(),
      input.protocol,
      input.baseUrl.trim(),
      input.model.trim(),
      input.apiKey ? sealSecret(input.apiKey) : null,
      maxClip,
      extraForm,
      count === 0 ? 1 : 0,
      now,
      now
    )
  }
  return toView(getRow(id)!)
}

export function deleteAsrProvider(id: string): void {
  const db = getDatabase()
  const row = getRow(id)
  if (!row) return
  db.transaction(() => {
    db.prepare('DELETE FROM asr_providers WHERE id = ?').run(id)
    if (row.is_default === 1) {
      const next = db
        .prepare('SELECT id FROM asr_providers ORDER BY created_at ASC LIMIT 1')
        .get() as { id: string } | undefined
      if (next) db.prepare('UPDATE asr_providers SET is_default = 1 WHERE id = ?').run(next.id)
    }
  })()
}

export function setDefaultAsrProvider(id: string): void {
  const db = getDatabase()
  if (!getRow(id)) throw new Error('转写提供方不存在')
  db.transaction(() => {
    db.prepare('UPDATE asr_providers SET is_default = 0').run()
    db.prepare('UPDATE asr_providers SET is_default = 1 WHERE id = ?').run(id)
  })()
}

/** 以草稿形态验证：未保存的表单也能测，apiKey 缺省时用已存的 */
export async function verifyAsrProvider(
  input: AsrProviderInput
): Promise<{ ok: true; message: string }> {
  validateInput(input)
  if (!input.model.trim()) throw new Error('请先填写模型')
  const existing = input.id ? getRow(input.id) : undefined
  const credential =
    input.apiKey !== undefined && input.apiKey !== ''
      ? input.apiKey
      : existing
        ? openSecret(existing.credential)
        : ''
  const client = createAsrClient({
    id: existing?.id ?? 'draft',
    name: input.name,
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    model: input.model,
    credential,
    maxClipSeconds: input.maxClipSeconds ?? existing?.max_clip_seconds ?? 600,
    extraForm: input.extraForm ?? {}
  })
  await client.verify()
  return { ok: true, message: `连接成功：${input.model}` }
}
