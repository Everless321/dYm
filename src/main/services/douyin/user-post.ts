import { UserPostFilter } from 'polydl'
import { fetchGuarded } from './page'

/**
 * 在页面上下文里翻作者作品列表。
 *
 * 作品列表接口进了抖音 ArgusSecurityPlugin 的保护名单：polydl 直连会被
 * HTTP 403「Blocked by ArgusSecurityPlugin Uifid Not Found」拦下——请求里缺 uifid，
 * 而 uifid / a_bogus / msToken 这些参数只有页面里的 secsdk 才补得上。
 * 与收藏接口同样的做法，交给 fetchGuarded 在真实抖音页面里发。
 *
 * 每页用 polydl 同一个 UserPostFilter 包装，行为对齐 handler.fetchUserPostVideos，
 * 调用方只换数据源，下游逻辑不动。
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

export async function* fetchUserPostPagesInPage(
  secUserId: string,
  { maxCounts = 0, interval = DEFAULT_INTERVAL_MS }: UserPostPageOptions = {}
): AsyncGenerator<UserPostFilter, void, unknown> {
  const cap = maxCounts > 0 ? maxCounts : Infinity
  let cursor = 0
  let collected = 0

  while (true) {
    const count = cap === Infinity ? PAGE_SIZE : Math.min(PAGE_SIZE, cap - collected)
    const raw = await fetchGuarded(USER_POST_PATH, {
      sec_user_id: secUserId,
      max_cursor: cursor,
      count
    })
    const page = new UserPostFilter(raw)
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
