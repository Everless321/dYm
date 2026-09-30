import { getSetting, setSetting } from '../../database'
import { openSecret, sealSecret } from '../ai/secret'
import type { LocalPolicy, StorageConfigInput, StorageConfigView } from '../../../shared/storage'
import type { S3Target } from './sigv4'

export interface StorageConfig {
  enabled: boolean
  target: S3Target
  publicBaseUrl: string
  relay: { url: string; token: string } | null
  concurrency: number
  localPolicy: LocalPolicy
  graceDays: number
  cacheBytes: number
}

const K = {
  enabled: 'storage_enabled',
  endpoint: 'storage_endpoint',
  region: 'storage_region',
  bucket: 'storage_bucket',
  accessKeyId: 'storage_access_key_id',
  secret: 'storage_secret_access_key',
  publicBaseUrl: 'storage_public_base_url',
  relayUrl: 'storage_relay_url',
  relayToken: 'storage_relay_token',
  concurrency: 'storage_concurrency',
  localPolicy: 'storage_local_policy',
  graceDays: 'storage_grace_days',
  cacheGb: 'storage_cache_gb'
} as const

const DEFAULT_CONCURRENCY = 2
const MAX_CONCURRENCY = 8
// 默认：上云核对通过 3 天后本地只留封面；取回原文件的缓存 20 GB
const DEFAULT_POLICY: LocalPolicy = 'covers'
const DEFAULT_GRACE_DAYS = 3
const DEFAULT_CACHE_GB = 20

// 读取路径（每张封面都要签名）会频繁取配置，解密钥匙串很慢，缓存到下次保存
let cached: StorageConfig | null | undefined

function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function readPolicy(value: string | null): LocalPolicy {
  return value === 'keep' || value === 'covers' ? value : DEFAULT_POLICY
}

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
  if (n === null || n === undefined || n === '') return fallback
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) ? Math.min(Math.max(v, min), max) : fallback
}

function clampConcurrency(n: unknown): number {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) && v >= 1 ? Math.min(v, MAX_CONCURRENCY) : DEFAULT_CONCURRENCY
}

/** 配置完整才返回；没配或没填全返回 null（不管开没开关，读取回退仍然要用） */
export function loadStorageConfig(): StorageConfig | null {
  if (cached !== undefined) return cached
  const endpoint = trimUrl(getSetting(K.endpoint) ?? '')
  const bucket = (getSetting(K.bucket) ?? '').trim()
  const accessKeyId = (getSetting(K.accessKeyId) ?? '').trim()
  const secretAccessKey = openSecret(getSetting(K.secret))
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    cached = null
    return cached
  }
  const relayUrl = trimUrl(getSetting(K.relayUrl) ?? '')
  const relayToken = openSecret(getSetting(K.relayToken))
  cached = {
    enabled: getSetting(K.enabled) === 'true',
    target: {
      endpoint,
      region: (getSetting(K.region) ?? '').trim() || 'auto',
      bucket,
      accessKeyId,
      secretAccessKey
    },
    publicBaseUrl: trimUrl(getSetting(K.publicBaseUrl) ?? ''),
    relay: relayUrl && relayToken ? { url: relayUrl, token: relayToken } : null,
    concurrency: clampConcurrency(getSetting(K.concurrency)),
    localPolicy: readPolicy(getSetting(K.localPolicy)),
    graceDays: clampInt(getSetting(K.graceDays), DEFAULT_GRACE_DAYS, 0, 365),
    cacheBytes: clampInt(getSetting(K.cacheGb), DEFAULT_CACHE_GB, 1, 10_000) * 1024 ** 3
  }
  return cached
}

export function getStorageConfigView(): StorageConfigView {
  return {
    enabled: getSetting(K.enabled) === 'true',
    endpoint: getSetting(K.endpoint) ?? '',
    region: getSetting(K.region) || 'auto',
    bucket: getSetting(K.bucket) ?? '',
    accessKeyId: getSetting(K.accessKeyId) ?? '',
    hasSecretAccessKey: Boolean(getSetting(K.secret)),
    publicBaseUrl: getSetting(K.publicBaseUrl) ?? '',
    relayUrl: getSetting(K.relayUrl) ?? '',
    hasRelayToken: Boolean(getSetting(K.relayToken)),
    concurrency: clampConcurrency(getSetting(K.concurrency)),
    localPolicy: readPolicy(getSetting(K.localPolicy)),
    graceDays: clampInt(getSetting(K.graceDays), DEFAULT_GRACE_DAYS, 0, 365),
    cacheGb: clampInt(getSetting(K.cacheGb), DEFAULT_CACHE_GB, 1, 10_000)
  }
}

function assertHttpUrl(value: string, label: string, required: boolean): void {
  if (!value) {
    if (required) throw new Error(`${label}不能为空`)
    return
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label}不是有效的地址：${value}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${label}必须以 http:// 或 https:// 开头`)
  }
}

/** 校验并保存。开关打开时要求配置完整；密钥 / token 留空表示沿用已保存的 */
export function saveStorageConfig(input: StorageConfigInput): StorageConfigView {
  const endpoint = trimUrl(input.endpoint ?? '')
  const bucket = (input.bucket ?? '').trim()
  const accessKeyId = (input.accessKeyId ?? '').trim()
  const publicBaseUrl = trimUrl(input.publicBaseUrl ?? '')
  const relayUrl = trimUrl(input.relayUrl ?? '')
  const secret = (input.secretAccessKey ?? '').trim()
  const relayToken = (input.relayToken ?? '').trim()

  assertHttpUrl(endpoint, 'Endpoint ', input.enabled)
  assertHttpUrl(publicBaseUrl, '公开访问域名', false)
  assertHttpUrl(relayUrl, '上传中转地址', false)
  if (bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('Bucket 名只能包含小写字母、数字、点和连字符，长度 3–63')
  }
  if (input.enabled) {
    if (!bucket) throw new Error('Bucket 不能为空')
    if (!accessKeyId) throw new Error('Access Key ID 不能为空')
    if (!secret && !getSetting(K.secret)) throw new Error('Secret Access Key 不能为空')
  }

  setSetting(K.enabled, input.enabled ? 'true' : 'false')
  setSetting(K.endpoint, endpoint)
  setSetting(K.region, (input.region ?? '').trim() || 'auto')
  setSetting(K.bucket, bucket)
  setSetting(K.accessKeyId, accessKeyId)
  if (secret) setSetting(K.secret, sealSecret(secret))
  setSetting(K.publicBaseUrl, publicBaseUrl)
  setSetting(K.relayUrl, relayUrl)
  if (relayToken) setSetting(K.relayToken, sealSecret(relayToken))
  if (!relayUrl) setSetting(K.relayToken, '')
  setSetting(K.concurrency, String(clampConcurrency(input.concurrency)))
  setSetting(K.localPolicy, readPolicy(input.localPolicy))
  setSetting(K.graceDays, String(clampInt(input.graceDays, DEFAULT_GRACE_DAYS, 0, 365)))
  setSetting(K.cacheGb, String(clampInt(input.cacheGb, DEFAULT_CACHE_GB, 1, 10_000)))

  cached = undefined
  return getStorageConfigView()
}
