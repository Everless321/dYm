import { DouyinCrawler } from 'polydl'
import { getSetting } from '../../database'

/**
 * 给 polydl 直连请求补 uifid。
 *
 * 被抖音加强管控的会话，作品列表等接口会被 ArgusSecurityPlugin 以
 * 「Uifid Not Found」拦下：真实网页请求都带 uifid，polydl 不带。
 * 这里在签名前把 uifid 加进参数，a_bogus 会把它一起算进去。
 *
 * 值的来源：页面请求里采到的（最准）> Cookie 里的 UIFID > 不带。
 * 正常会话带上 uifid 也照常返回，所以有值就一律带。
 *
 * 临时做法：model2Endpoint 是 polydl 的私有方法，验证有效后应挪进 polydl。
 */

let pageUifid: string | null = null

/** 记下页面里采到的 uifid，之后的直连请求都带上 */
export function setDirectUifid(value: string | null): void {
  pageUifid = value
}

function cookieUifid(): string | null {
  const match = (getSetting('douyin_cookie') ?? '').match(/(?:^|;\s*)UIFID=([^;]+)/)
  return match ? match[1] : null
}

export function currentUifid(): string | null {
  return pageUifid ?? cookieUifid()
}

type Model2Endpoint = (
  baseEndpoint: string,
  params: Record<string, unknown>,
  body?: string
) => Promise<string>

const proto = DouyinCrawler.prototype as unknown as { model2Endpoint: Model2Endpoint }
const original = proto.model2Endpoint

proto.model2Endpoint = function (this: unknown, baseEndpoint, params, body) {
  const uifid = currentUifid()
  return original.call(this, baseEndpoint, uifid ? { ...params, uifid } : params, body)
}
