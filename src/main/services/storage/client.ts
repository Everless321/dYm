import { createReadStream } from 'fs'
import { Readable } from 'stream'
import type { StorageConfig } from './config'
import type { LocalObject, ObjectStore } from './sync-post'
import { MAX_ATTEMPTS } from './sync-post'
import { alignedSigningWindow, presignUrl } from './sigv4'
import type { StorageTestResult } from '../../../shared/storage'

const UPLOAD_URL_TTL = 3600
// 家宽上行按 100 KB/s 兜底估算超时，最少 2 分钟，避免大文件被误判超时、小文件又挂太久
const MIN_UPLOAD_TIMEOUT_MS = 120_000
const WORST_CASE_BYTES_PER_MS = 100

function presignNow(
  config: StorageConfig,
  method: 'PUT' | 'HEAD' | 'GET' | 'DELETE',
  key: string | null,
  query?: Record<string, string>
): string {
  return presignUrl(config.target, {
    method,
    key,
    query,
    date: new Date(),
    expiresIn: UPLOAD_URL_TTL
  })
}

async function describeFailure(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1]
  return `HTTP ${res.status}${code ? ` ${code}` : body ? ` ${body.slice(0, 120)}` : ''}`
}

export async function headObject(config: StorageConfig, key: string): Promise<number | null> {
  const res = await fetch(presignNow(config, 'HEAD', key), {
    method: 'HEAD',
    signal: AbortSignal.timeout(30_000)
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HEAD ${key} 失败：HTTP ${res.status}`)
  const size = Number(res.headers.get('content-length'))
  return Number.isFinite(size) ? size : null
}

function xmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 列出某个前缀下的全部对象（ListObjectsV2，自动翻页） */
export async function listObjects(
  config: StorageConfig,
  prefix: string,
  onPage?: (listedSoFar: number) => void
): Promise<{ key: string; size: number }[]> {
  const result: { key: string; size: number }[] = []
  let token: string | null = null
  do {
    const query: Record<string, string> = { 'list-type': '2', prefix }
    if (token) query['continuation-token'] = token
    const res = await fetch(presignNow(config, 'GET', null, query), {
      signal: AbortSignal.timeout(30_000)
    })
    if (!res.ok) throw new Error(`列出 ${prefix} 失败：${await describeFailure(res)}`)
    const xml = await res.text()
    for (const [, block] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1]
      const size = /<Size>(\d+)<\/Size>/.exec(block)?.[1]
      if (key && size) result.push({ key: xmlText(key), size: Number(size) })
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    const next = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
    token = truncated && next ? xmlText(next) : null
    onPage?.(result.length)
  } while (token)
  return result
}

/** 删除对象；不存在也算成功（S3 语义本来就是幂等的） */
export async function deleteObject(config: StorageConfig, key: string): Promise<void> {
  const res = await fetch(presignNow(config, 'DELETE', key), {
    method: 'DELETE',
    signal: AbortSignal.timeout(30_000)
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`删除 ${key} 失败：${await describeFailure(res)}`)
  }
}

/**
 * 上传一个文件。配了中转时前 MAX_ATTEMPTS-1 次走中转、最后一次回退直传
 * （与节点 Agent 同一套策略：国内直连 R2 大量 502，中转挂了也不至于全部失败）。
 */
export async function putObject(
  config: StorageConfig,
  obj: LocalObject,
  attempt: number
): Promise<void> {
  const presigned = presignNow(config, 'PUT', obj.key)
  const viaRelay = config.relay !== null && attempt < MAX_ATTEMPTS
  const url = viaRelay ? `${config.relay!.url}/r2?url=${encodeURIComponent(presigned)}` : presigned
  const headers: Record<string, string> = {
    'content-type': obj.contentType,
    'content-length': String(obj.size)
  }
  if (viaRelay) headers.authorization = `Bearer ${config.relay!.token}`

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: Readable.toWeb(createReadStream(obj.path)) as ReadableStream,
    // Node fetch 流式请求体必须声明 half duplex
    duplex: 'half',
    signal: AbortSignal.timeout(Math.max(MIN_UPLOAD_TIMEOUT_MS, obj.size / WORST_CASE_BYTES_PER_MS))
  } as RequestInit)
  if (!res.ok) {
    throw new Error(
      `${viaRelay ? 'relay' : 'direct'}: PUT ${obj.key} ${await describeFailure(res)}`
    )
  }
}

export function createObjectStore(config: StorageConfig): ObjectStore {
  return {
    head: (key) => headObject(config, key),
    put: (obj, attempt) => putObject(config, obj, attempt)
  }
}

/** 列一个对象来验证地址、bucket 和密钥（只读，不写测试文件） */
export async function testStorageConnection(config: StorageConfig): Promise<StorageTestResult> {
  try {
    const res = await fetch(
      presignNow(config, 'GET', null, { 'list-type': '2', 'max-keys': '1' }),
      { signal: AbortSignal.timeout(15_000) }
    )
    if (res.ok) return { ok: true, message: `连接成功，bucket「${config.target.bucket}」可访问` }
    const reason = await describeFailure(res)
    if (res.status === 403) return { ok: false, message: `密钥无权访问该 bucket（${reason}）` }
    if (res.status === 404) return { ok: false, message: `bucket 不存在（${reason}）` }
    return { ok: false, message: `连接失败：${reason}` }
  } catch (error) {
    return { ok: false, message: `无法连接 Endpoint：${(error as Error).message}` }
  }
}

/** 读取地址：配了公开域名直接拼，否则按整点窗口预签名（同一小时内 URL 不变，缓存可命中） */
export function remoteObjectUrl(config: StorageConfig, key: string): string {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`
  }
  return presignUrl(config.target, { method: 'GET', key, ...alignedSigningWindow() })
}
