import { createHash, createHmac } from 'crypto'

/**
 * S3 兼容存储的 SigV4 查询串签名（预签名 URL）。
 *
 * 不引入 AWS SDK：签名是纯同步计算，findMediaFiles 这种同步路径里也能直接生成播放地址，
 * 上传 / HEAD / LIST 都用预签名 URL + fetch 完成，中转（relay）也只认预签名地址。
 * 正确性由 sigv4.test.ts 对照 @aws-sdk/s3-request-presigner 逐字节校验。
 */

export interface S3Target {
  /** 例如 https://<account>.r2.cloudflarestorage.com，不带 bucket */
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export interface PresignOptions {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE'
  /** 对象 key；null 表示对 bucket 本身签名（ListObjectsV2） */
  key: string | null
  query?: Record<string, string>
  date: Date
  expiresIn: number
}

const WINDOW_SECONDS = 3600

/** RFC 3986：encodeURIComponent 之外还要转义 !'()* */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function amzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

export function presignUrl(target: S3Target, opts: PresignOptions): string {
  const endpoint = new URL(target.endpoint)
  const host = endpoint.host
  const segments = [target.bucket, ...(opts.key === null ? [] : opts.key.split('/'))]
  // path-style：/bucket/key，每段单独编码，斜杠保留
  const path =
    endpoint.pathname.replace(/\/$/, '') +
    '/' +
    segments.map(uriEncode).join('/') +
    (opts.key === null ? '/' : '')

  const stamp = amzDate(opts.date)
  const day = stamp.slice(0, 8)
  const scope = `${day}/${target.region}/s3/aws4_request`

  const params: Record<string, string> = {
    ...opts.query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${target.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(opts.expiresIn),
    'X-Amz-SignedHeaders': 'host'
  }
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join('&')

  const canonicalRequest = [
    opts.method,
    path,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
  ].join('\n')

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${target.secretAccessKey}`, day), target.region), 's3'),
    'aws4_request'
  )
  const signature = hmac(signingKey, stringToSign).toString('hex')

  return `${endpoint.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

/**
 * 读取用的签名时间对齐到整点、有效期两个窗口：同一小时内同一对象的 URL 逐字符相同，
 * 浏览器缓存才能命中（每次都签新 URL 等于每次都重下封面）；剩余有效期始终 ≥ 1 小时。
 */
export function alignedSigningWindow(now: Date = new Date()): { date: Date; expiresIn: number } {
  const start = Math.floor(now.getTime() / (WINDOW_SECONDS * 1000)) * WINDOW_SECONDS * 1000
  return { date: new Date(start), expiresIn: WINDOW_SECONDS * 2 }
}
