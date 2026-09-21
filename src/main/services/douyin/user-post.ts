import { DouyinCrawler, UserPostFilter } from 'polydl'
import { getSetting } from '../../database'
import { diagnoseUserPost } from './client'
import { fetchGuarded, getPageUifid } from './page'

/**
 * 翻作者作品列表：直连优先，被拦了再退。
 *
 * 多数会话 polydl 直连就能拿到，最快；被抖音加强管控的会话会被 ArgusSecurityPlugin
 * 以 HTTP 403「Uifid Not Found」拦下（polydl 不抛错，statusCode 为 null）。这时：
 * 1. 从页面请求里采 uifid，经 polydl 的 setUifid 补进直连再试一次——通了就继续直连；
 * 2. 仍不通就改在页面上下文里请求（fetchGuarded，uifid 等参数由页面补），
 *    并对这个会话记住，后面不再白白试直连。
 *
 * 每页都是 polydl 的 UserPostFilter，翻页语义与默认值对齐 handler.fetchUserPostVideos。
 */

const USER_POST_PATH = '/aweme/v1/web/aweme/post/'

/** 与 polydl fetchUserPostVideos 的默认值一致：每页 20 条，页间 5 秒 */
const PAGE_SIZE = 20
const DEFAULT_INTERVAL_MS = 5000

export interface UserPostPageOptions {
  /** 条数上限，0 = 翻到最后一页 */
  maxCounts?: number
  /** 页间等待（毫秒） */
  interval?: number
}

type Route = 'direct' | 'page'

/** 按会话记住走哪条路；换了 Cookie（重新登录）就重新从直连试起 */
let remembered: { session: string; route: Route } | null = null
let crawler: { cookie: string; instance: DouyinCrawler } | null = null
/**
 * 页面请求里采到的 uifid。polydl 默认用 Cookie 里的 UIFID，
 * 有采样值时用 setUifid 覆盖（设备级，换 Cookie 也沿用）。
 */
let sampledUifid: string | null = null

function currentCookie(): string {
  return getSetting('douyin_cookie') ?? ''
}

function sessionOf(cookie: string): string {
  return cookie.match(/(?:^|;\s*)sessionid=([^;]+)/)?.[1] ?? ''
}

function routeFor(cookie: string): Route {
  return remembered?.session === sessionOf(cookie) ? remembered.route : 'direct'
}

function cookieUifid(cookie: string): string | null {
  return cookie.match(/(?:^|;\s*)UIFID=([^;]+)/)?.[1] ?? null
}

function remember(cookie: string, route: Route): void {
  remembered = { session: sessionOf(cookie), route }
}

/** 同一份 Cookie 复用一个 crawler，省掉重复取 msToken */
function crawlerFor(cookie: string): DouyinCrawler {
  if (crawler?.cookie !== cookie) {
    crawler = { cookie, instance: new DouyinCrawler({ cookie, uifid: sampledUifid ?? undefined }) }
  }
  return crawler.instance
}

async function fetchDirect(
  cookie: string,
  secUserId: string,
  cursor: number,
  count: number
): Promise<UserPostFilter | null> {
  try {
    const res = await crawlerFor(cookie).fetchUserPost(secUserId, cursor, count)
    const page = new UserPostFilter(res.data as Record<string, unknown>)
    // null = 非 JSON（被 Argus 拦）；status_code≠0 的风控 JSON 原样交给调用方报错
    return page.statusCode === null ? null : page
  } catch (error) {
    // 空响应体等 polydl 重试后仍失败，同样当作直连不可用
    console.warn('[UserPost] 直连请求失败:', (error as Error).message)
    return null
  }
}

async function fetchViaPage(
  secUserId: string,
  cursor: number,
  count: number
): Promise<UserPostFilter> {
  const raw = await fetchGuarded(USER_POST_PATH, {
    sec_user_id: secUserId,
    max_cursor: cursor,
    count
  })
  return new UserPostFilter(raw)
}

async function fetchOnePage(
  secUserId: string,
  cursor: number,
  count: number
): Promise<UserPostFilter> {
  const cookie = currentCookie()
  const startedAt = Date.now()
  const elapsed = (): string => `${Date.now() - startedAt}ms`

  if (routeFor(cookie) === 'direct') {
    const direct = await fetchDirect(cookie, secUserId, cursor, count)
    if (direct) {
      console.log(`[UserPost] 直连 cursor=${cursor} ${elapsed()}`)
      return direct
    }

    // 被拦：先把原始请求 / 响应打出来，再补上页面里的 uifid 直连一次
    console.log(`[UserPost] 直连诊断：${await diagnoseUserPost(secUserId)}`)
    const hadUifid = sampledUifid ?? cookieUifid(cookie)
    const uifid = await getPageUifid().catch(() => null)
    if (uifid && uifid !== hadUifid) {
      sampledUifid = uifid
      crawlerFor(cookie).setUifid(uifid)
      const retried = await fetchDirect(cookie, secUserId, cursor, count)
      if (retried) {
        console.log(`[UserPost] 直连补 uifid 后可用，继续直连 cursor=${cursor} ${elapsed()}`)
        remember(cookie, 'direct')
        return retried
      }
    }

    console.log(
      `[UserPost] 直连被拦（uifid: ${uifid ? '已补仍不行' : '页面里没采到'}），本会话改走页面上下文`
    )
    remember(cookie, 'page')
  }

  const page = await fetchViaPage(secUserId, cursor, count)
  console.log(`[UserPost] 页面 cursor=${cursor} ${elapsed()}`)
  return page
}

export async function* fetchUserPostPages(
  secUserId: string,
  { maxCounts = 0, interval = DEFAULT_INTERVAL_MS }: UserPostPageOptions = {}
): AsyncGenerator<UserPostFilter, void, unknown> {
  const cap = maxCounts > 0 ? maxCounts : Infinity
  let cursor = 0
  let collected = 0

  while (true) {
    const count = cap === Infinity ? PAGE_SIZE : Math.min(PAGE_SIZE, cap - collected)
    const page = await fetchOnePage(secUserId, cursor, count)
    yield page

    if (!page.hasMore) return
    const next = page.maxCursor
    if (next === null || next === cursor) return
    cursor = next

    collected += page.awemeId?.length || 0
    if (collected >= cap) return
    if (interval > 0) await new Promise((resolve) => setTimeout(resolve, interval))
  }
}
