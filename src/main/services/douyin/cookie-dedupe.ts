/**
 * 同名 Cookie 只留一份，返回保留的与被顶掉的。
 *
 * 同名会有两份：页面 JS 用 document.cookie 写的是 www.douyin.com 的 host-only Cookie，
 * 而后台页面把设置里的 Cookie 统一注入到 .douyin.com（见 page.ts injectCookies），
 * 于是 s_v_web_id、web_sign_token 等出现两份，值还可能不一致。浏览器会把两份都发出去。
 * host-only 那份是页面自己维护的最新值，以它为准。
 */
export function dedupeCookies<T extends { name: string; hostOnly?: boolean }>(
  cookies: T[]
): { kept: T[]; shadowed: T[] } {
  const byName = new Map<string, T>()
  const shadowed: T[] = []
  for (const cookie of cookies) {
    const current = byName.get(cookie.name)
    if (!current) {
      byName.set(cookie.name, cookie)
    } else if (cookie.hostOnly && !current.hostOnly) {
      byName.set(cookie.name, cookie)
      shadowed.push(current)
    } else {
      shadowed.push(cookie)
    }
  }
  return { kept: [...byName.values()], shadowed }
}
