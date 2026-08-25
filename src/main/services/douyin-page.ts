import { BrowserWindow, session, type Session } from 'electron'
import { getSetting } from '../database'
import { blockCustomProtocols } from '../utils/block-protocols'

/**
 * 在真实抖音页面里发接口请求。
 *
 * 为什么要绕这一圈：收藏、收藏夹、点赞这三个接口被抖音的 ArgusSecurityPlugin 保护，
 * 必须带 `x-secsdk-web-signature`——它由页面里的 secsdk 对整条 query 签名生成，
 * 改一个参数就失效，逆向成本高且抖音随时会改。放在页面里发，签名是页面自己补的。
 *
 * 其余接口（作者作品、资料、详情等）不受影响，仍然走 polydl 直连，不必经过这里。
 */

/** 登录窗口用的分区，与 cookie.ts 共用，这样用户登录过就直接是登录态 */
const PARTITION = 'persist:douyin-login'

/** 抹掉 UA 里的 Electron 标识。页面会把 UA 解析成 browser_name/browser_version 发给抖音，
 *  不改的话每个请求都在自报「我是 Electron/39.3.0」。 */
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

/** 页面停靠地址：个人页收藏 tab，加载后页面自己会发一次带完整参数的接口请求 */
const HOME_URL = 'https://www.douyin.com/user/self?showTab=favorite_collection'

/** 等页面发出可取样请求的上限 */
const SAMPLE_TIMEOUT_MS = 40_000
const SAMPLE_POLL_MS = 1500

/** 空闲这么久就把窗口关掉，别一直占着内存 */
const IDLE_CLOSE_MS = 5 * 60_000

/**
 * 这些参数一律不自己填，交给页面补。
 * 自己填会和 secsdk/抖音自己的拦截器重复，签名对不上，返回 Sign Invalid。
 */
const PAGE_OWNED_PARAMS = new Set([
  'webid',
  'uifid',
  'msToken',
  'a_bogus',
  'verifyFp',
  'fp',
  'timestamp',
  'x-secsdk-web-signature'
])

interface PageResponse {
  ok: boolean
  status: number
  /** 解析成功的 JSON；非 JSON 时为 null */
  data: Record<string, unknown> | null
  /** 非 JSON 时的原文，用于报错 */
  text: string | null
}

let win: BrowserWindow | null = null
/** 从页面已发请求里抠出的业务参数（device_platform / browser_* / os_* 等） */
let bizParams: string | null = null
/** 串行化，避免并发 executeJavaScript 互相干扰 */
let queue: Promise<unknown> = Promise.resolve()
let idleTimer: NodeJS.Timeout | null = null

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => closePage(), IDLE_CLOSE_MS)
}

/** 关掉页面窗口。下次调用会重新开，业务参数也重新取。 */
export function closePage(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  bizParams = null
}

/**
 * 把设置里那串 cookie 灌进分区。
 * 用户从没在登录窗口登录过时，分区本身是空的，全靠这一步。
 */
async function injectCookies(ses: Session): Promise<number> {
  const raw = getSetting('douyin_cookie')
  if (!raw) throw new Error('未配置抖音 Cookie，请先在「设置 - 账号」里登录')

  let count = 0
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    try {
      await ses.cookies.set({
        url: 'https://www.douyin.com',
        name,
        value: part.slice(eq + 1).trim(),
        domain: '.douyin.com',
        path: '/',
        secure: true
      })
      count++
    } catch {
      // 个别 cookie 名不合法就跳过，不影响整体登录态
    }
  }
  return count
}

/**
 * 取出业务参数。
 * 做法是等页面自己发一次接口请求，从它的 URL 里抄参数——这样不管抖音以后加了什么
 * 新的业务参数，我们都会跟着带上，不用手工维护一张表。
 */
async function readBizParams(target: BrowserWindow): Promise<string> {
  const script = `
    (() => {
      const url = performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .find((name) => /\\/aweme\\/v1\\/web\\/.*(a_bogus|msToken)/.test(name))
      if (!url) return null
      const skip = ${JSON.stringify([...PAGE_OWNED_PARAMS])}
      const query = new URLSearchParams(url.split('?')[1] || '')
      const kept = []
      for (const [key, value] of query.entries()) {
        if (skip.includes(key)) continue
        if (key === 'cursor' || key === 'count' || key === 'sec_user_id') continue
        kept.push(key + '=' + encodeURIComponent(value))
      }
      return kept.join('&')
    })()
  `
  const deadline = Date.now() + SAMPLE_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (target.isDestroyed()) throw new Error('抖音页面窗口已关闭')
    const found = (await target.webContents.executeJavaScript(script).catch(() => null)) as
      | string
      | null
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_POLL_MS))
  }
  throw new Error('抖音页面未发出可取样的请求，可能是 Cookie 已失效，请重新登录')
}

/** 确保窗口就绪且业务参数已取到 */
async function ensurePage(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed() && bizParams) {
    scheduleIdleClose()
    return win
  }

  closePage()
  const ses = session.fromPartition(PARTITION)
  ses.setUserAgent(CHROME_UA)
  await injectCookies(ses)

  const created = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: {
      partition: PARTITION,
      // 必须关隔离：开着的话 executeJavaScript 跑在隔离世界，用不到页面被 secsdk
      // 改造过的 fetch，请求会以「用户未登录」失败。配合 nodeIntegration:false，
      // 页面拿不到 Node，风险限于注入脚本可能被页面 JS 干扰，只读取数据可以接受。
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false
    }
  })
  created.webContents.setUserAgent(CHROME_UA)
  blockCustomProtocols(created)

  // 不 await：抖音个人页是长连接型 SPA，loadURL 常常不 resolve
  created.loadURL(HOME_URL).catch(() => {})
  win = created

  try {
    bizParams = await readBizParams(created)
  } catch (error) {
    closePage()
    throw error
  }

  scheduleIdleClose()
  return created
}

/**
 * 在页面里发一次接口请求。
 *
 * @param path   接口路径，如 /aweme/v1/web/collects/list/
 * @param params 业务参数（cursor / count / collects_id 之类），安全参数不要传
 * @param method listcollection 是 POST，用 GET 会返回 404 Unsupported path(Janus)
 */
async function requestInPage(
  path: string,
  params: Record<string, string | number>,
  method: 'GET' | 'POST'
): Promise<PageResponse> {
  const target = await ensurePage()
  const extra = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&')
  const url = `${path}?${bizParams}${extra ? `&${extra}` : ''}`

  const script = `
    (async () => {
      const response = await fetch(${JSON.stringify(url)}, {
        method: ${JSON.stringify(method)},
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' }
      })
      const text = await response.text()
      let data = null
      try { data = JSON.parse(text) } catch (error) { data = null }
      return { ok: response.ok, status: response.status, data, text: data ? null : text.slice(0, 200) }
    })()
  `
  return (await target.webContents.executeJavaScript(script)) as PageResponse
}

/** 串行执行，页面一次只处理一个请求 */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  // 失败不能让后续任务一起挂掉，所以这里吞掉链上的错误（调用方仍拿得到）
  queue = run.catch(() => undefined)
  return run
}

/**
 * 请求受 Argus 保护的接口，返回解析后的 JSON。
 * 拿不到 JSON 或 status_code 非 0 时抛出可读的错误，绝不静默返回空。
 */
export async function fetchGuarded(
  path: string,
  params: Record<string, string | number> = {},
  method: 'GET' | 'POST' = 'GET'
): Promise<Record<string, unknown>> {
  return serialize(async () => {
    const response = await requestInPage(path, params, method)

    if (!response.data) {
      const hint = response.text?.includes('ArgusSecurityPlugin')
        ? '（接口被抖音安全策略拦截）'
        : ''
      throw new Error(`抖音接口返回异常 ${response.status}${hint}：${response.text ?? '空响应'}`)
    }

    const statusCode = Number(response.data.status_code ?? 0)
    if (statusCode !== 0) {
      const message = String(response.data.status_msg ?? '未知错误')
      throw new Error(`抖音接口报错 status_code=${statusCode}：${message}`)
    }

    return response.data
  })
}
