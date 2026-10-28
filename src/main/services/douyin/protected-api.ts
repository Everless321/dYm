import { DouyinCrawler, getDevice, webRequestParamsOf } from 'polydl'
import { getSetting } from '../../database'
import { fetchGuarded } from './page'

/**
 * 收藏、收藏夹、取消收藏这几个接口：直连优先，不行再退回页面。
 *
 * 这些接口原先必须在真实页面里请求，靠页面补 x-secsdk-web-signature。2026-10 实测
 * 直连不带这个签名也能通（polydl 已补 x-tt-argus / uifid），而页面一旦被抖音转到验证码页
 * 就拿不到任何数据，所以改成直连优先。直连被拦时退回页面，并对这个会话记住，后面不再白白试直连。
 * 被拦的样子不止非 JSON、空响应：同一会话直连还会突然收到 status_code=8「用户未登录」或 5，
 * 而登录态其实有效。所以直连拿到 status_code 非 0 也退回页面，由页面的结果为准。
 * 只在页面成功后记住走页面。
 *
 * polydl 没有公开「按路径签名并请求」的方法，这里用它内部的 model2Endpoint / fetchGetJson /
 * fetchPostJson。升级 polydl 后这些方法不在了，就直接走页面，不会报错。
 */

const DOUYIN_ORIGIN = 'https://www.douyin.com'
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded; charset=UTF-8'

type Fields = Record<string, string | number>

type HttpResponse = Awaited<ReturnType<DouyinCrawler['fetchUserCollects']>>

interface CrawlerInternals {
  model2Endpoint(base: string, params: Fields, body?: string): Promise<string>
  fetchGetJson(endpoint: string): Promise<HttpResponse>
  fetchPostJson(endpoint: string, body: string): Promise<HttpResponse>
}

type Route = 'direct' | 'page'

/** 按会话记住走哪条路；换了 Cookie（重新登录）就重新从直连试起 */
let remembered: { session: string; route: Route } | null = null
/** 同一份 Cookie 复用 crawler，省掉重复取 msToken。表单 POST 要单独的 Content-Type，分开放 */
let crawlers: { cookie: string; plain: DouyinCrawler; form: DouyinCrawler } | null = null

function sessionOf(cookie: string): string {
  return cookie.match(/(?:^|;\s*)sessionid=([^;]+)/)?.[1] ?? ''
}

function internalsOf(crawler: DouyinCrawler): CrawlerInternals | null {
  const candidate = crawler as unknown as Partial<CrawlerInternals>
  return typeof candidate.model2Endpoint === 'function' &&
    typeof candidate.fetchGetJson === 'function' &&
    typeof candidate.fetchPostJson === 'function'
    ? (candidate as CrawlerInternals)
    : null
}

function crawlerFor(cookie: string, form: boolean): DouyinCrawler {
  if (crawlers?.cookie !== cookie) {
    crawlers = {
      cookie,
      plain: new DouyinCrawler({ cookie }),
      form: new DouyinCrawler({ cookie, headers: { 'Content-Type': FORM_CONTENT_TYPE } })
    }
  }
  return form ? crawlers.form : crawlers.plain
}

/** 与 polydl 内置接口的公共参数一致（它的 getBaseRequestParams 没有导出）；msToken 等由签名时补 */
function baseParams(): Fields {
  const device = webRequestParamsOf(getDevice())
  return {
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    pc_client_type: 1,
    publish_video_strategy_type: 2,
    pc_libra_divert: device.pc_libra_divert,
    version_code: '290100',
    version_name: '29.1.0',
    cookie_enabled: 'true',
    screen_width: device.screen_width,
    screen_height: device.screen_height,
    browser_language: device.browser_language,
    browser_platform: device.browser_platform,
    browser_name: device.browser_name,
    browser_version: device.browser_version,
    browser_online: 'true',
    engine_name: device.engine_name,
    engine_version: device.engine_version,
    os_name: device.os_name,
    os_version: device.os_version,
    cpu_core_num: device.cpu_core_num,
    device_memory: device.device_memory,
    platform: 'PC',
    downlink: 10,
    effective_type: '4g',
    round_trip_time: 100
  }
}

function encodeForm(fields: Fields): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&')
}

/** 直连一次。拿不到 JSON（被拦、空响应、polydl 内部方法不在了）返回 null */
async function fetchDirect(
  cookie: string,
  path: string,
  params: Fields,
  method: 'GET' | 'POST',
  body?: Fields
): Promise<Record<string, unknown> | null> {
  const internals = internalsOf(crawlerFor(cookie, Boolean(body)))
  if (!internals) return null
  try {
    const form = body ? encodeForm(body) : ''
    const endpoint = await internals.model2Endpoint(
      `${DOUYIN_ORIGIN}${path}`,
      { ...baseParams(), ...params },
      form
    )
    const response =
      method === 'GET'
        ? await internals.fetchGetJson(endpoint)
        : await internals.fetchPostJson(endpoint, form)
    const data = response.data
    if (data && typeof data === 'object') return data as Record<string, unknown>
    const text = typeof data === 'string' ? data.slice(0, 200) : ''
    console.warn(`[ProtectedApi] 直连非 JSON 响应 HTTP ${response.status}：${text || '（空）'}`)
    return null
  } catch (error) {
    console.warn('[ProtectedApi] 直连请求失败:', (error as Error).message)
    return null
  }
}

/**
 * 请求收藏类接口，返回解析后的 JSON。参数含义与 page.ts 的 fetchGuarded 相同，
 * 页面也失败时抛出 fetchGuarded 的错误。
 */
export async function fetchProtected(
  path: string,
  params: Fields = {},
  method: 'GET' | 'POST' = 'GET',
  body?: Fields
): Promise<Record<string, unknown>> {
  const cookie = getSetting('douyin_cookie') ?? ''
  const session = sessionOf(cookie)
  const route = remembered?.session === session ? remembered.route : 'direct'

  if (route === 'direct') {
    const data = await fetchDirect(cookie, path, params, method, body)
    if (data && Number(data.status_code ?? 0) === 0) return data
    const reason = data
      ? `status_code=${data.status_code} ${String(data.status_msg ?? '')}`
      : '被拦'
    console.log(`[ProtectedApi] 直连不可用（${path}，${reason}），改走页面`)
  }

  const data = await fetchGuarded(path, params, method, body)
  // 页面成功了才记住走页面；页面也失败（如验证码）时下次仍先试直连，它可能已经恢复
  remembered = { session, route: 'page' }
  return data
}
