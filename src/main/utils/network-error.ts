/**
 * 把 Node fetch 笼统的「fetch failed」展开成具体原因。
 *
 * undici 把真正的错误放在 error.cause 里（连多个地址都失败时还会是 AggregateError），
 * 只看 message 永远是「fetch failed」，没法判断是超时、被重置还是 DNS 失败。
 */

const REASONS: Record<string, string> = {
  ECONNRESET: '连接被重置',
  ECONNREFUSED: '连接被拒绝',
  ECONNABORTED: '连接被中止',
  EPIPE: '连接已断开（写入时）',
  ETIMEDOUT: '连接超时',
  ENOTFOUND: 'DNS 解析失败',
  EAI_AGAIN: 'DNS 解析失败（暂时）',
  ENETUNREACH: '网络不可达',
  EHOSTUNREACH: '主机不可达',
  UND_ERR_CONNECT_TIMEOUT: '连接超时',
  UND_ERR_HEADERS_TIMEOUT: '等待响应超时',
  UND_ERR_BODY_TIMEOUT: '读取响应超时',
  UND_ERR_SOCKET: '连接意外断开',
  UND_ERR_CLOSED: '连接已关闭',
  UND_ERR_REQ_CONTENT_LENGTH_MISMATCH: '请求体长度与 Content-Length 不一致',
  ERR_TLS_CERT_ALTNAME_INVALID: '证书域名不匹配',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: '证书校验失败',
  CERT_HAS_EXPIRED: '证书已过期',
  SELF_SIGNED_CERT_IN_CHAIN: '证书链里有自签证书（可能被代理劫持）',
  DEPTH_ZERO_SELF_SIGNED_CERT: '自签证书（可能被代理劫持）'
}

interface ErrorLike {
  name?: string
  message?: string
  code?: string
  cause?: unknown
  errors?: unknown[]
}

function asErrorLike(value: unknown): ErrorLike | null {
  return value && typeof value === 'object' ? (value as ErrorLike) : null
}

/** 沿着 cause / AggregateError.errors 往下收集所有层的错误 */
function chainOf(error: unknown): ErrorLike[] {
  const chain: ErrorLike[] = []
  const queue: unknown[] = [error]
  while (queue.length > 0 && chain.length < 8) {
    const current = asErrorLike(queue.shift())
    if (!current || chain.includes(current)) continue
    chain.push(current)
    if (current.cause) queue.push(current.cause)
    if (Array.isArray(current.errors)) queue.push(...current.errors)
  }
  return chain
}

export function describeNetworkError(error: unknown): string {
  const chain = chainOf(error)
  if (chain.length === 0) return String(error)

  if (chain.some((e) => e.name === 'TimeoutError')) return '请求超时（超过设定的等待时间）'
  if (chain.some((e) => e.name === 'AbortError')) return '请求被中止'

  const coded = chain.find((e) => e.code && REASONS[e.code]) ?? chain.find((e) => e.code)
  const top = chain[0].message ?? String(error)
  if (!coded?.code) {
    // 不是网络层错误（比如我们自己抛的 HTTP 403），原样返回
    const detail = chain.slice(1).find((e) => e.message && e.message !== top)?.message
    return detail ? `${top}（${detail}）` : top
  }

  const reason = REASONS[coded.code] ?? '网络错误'
  const detail = coded.message && !coded.message.includes(coded.code) ? `：${coded.message}` : ''
  return `${reason}（${coded.code}${detail}）`
}
