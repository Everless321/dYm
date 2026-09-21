import { BrowserWindow, session } from 'electron'
import { setSetting } from '../../database'
import { refreshDouyinHandler } from './client'
import { blockCustomProtocols } from '../../utils/block-protocols'
import { getBrowserUserAgent } from '../../utils/user-agent'
import { commitDeviceProfile, createMachineProfile } from './device'
import { closePage } from './page'
import { userAgentOf } from 'polydl'

// Cookie 刷新状态
let isRefreshing = false
let lastRefreshTime = 0
const MIN_REFRESH_INTERVAL = 30000 // 最小刷新间隔 30 秒
/** 只有这些会话 cookie 之一存在才算真正登录了抖音 */
const LOGIN_COOKIE_NAMES = new Set(['sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard'])

/**
 * 读出浏览器访问 www.douyin.com 时实际会带的全部 Cookie。
 *
 * 不能用 `{ domain: '.douyin.com' }`：它只返回挂在 .douyin.com 上的，漏掉 www.douyin.com
 * 的 host-only Cookie——其中的 s_v_web_id 是 verifyFp / fp 的来源，缺了它 detail 等接口会被
 * ArgusSecurityPlugin 判「Signature Not Found」；fpk1 / fpk2 / web_sign_token 等指纹 Cookie 也会一并丢失。
 */
function readDouyinCookies(ses: Electron.Session): Promise<Electron.Cookie[]> {
  return ses.cookies.get({ url: 'https://www.douyin.com' })
}

/**
 * 打开浏览器窗口让用户登录获取 Cookie（手动模式）
 */
export async function fetchDouyinCookie(): Promise<string> {
  const partition = 'persist:douyin-login'
  const ses = session.fromPartition(partition)

  // 分区里已经有登录态：什么都不动，用当前指纹打开窗口，用户看到的就是已登录的抖音，
  // 关窗时把 cookie 重新导出一遍即可（这是「从浏览器获取」一直以来的体验）。
  //
  // 分区里没有登录态（首次使用 / 已登出）：这次登录 = 换一台「新机器」——
  // 生成候选指纹先用在登录窗口上，把旧指纹下发的 ttwid / s_v_web_id 等匿名 cookie 清掉，
  // 登录成功后候选指纹与新 Cookie 一起落库；没登录就关窗则候选作废，继续沿用旧指纹。
  const existing = await readDouyinCookies(ses)
  const alreadyLoggedIn = existing.some((c) => LOGIN_COOKIE_NAMES.has(c.name))
  const candidate = alreadyLoggedIn ? null : createMachineProfile()
  if (candidate) await ses.clearStorageData({ storages: ['cookies'] })
  const userAgent = candidate ? userAgentOf(candidate) : getBrowserUserAgent()
  console.log(`[Cookie] 打开登录窗口（${alreadyLoggedIn ? '沿用已有登录态与指纹' : '新指纹'}）`)

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      title: '登录抖音 - 登录后关闭此窗口',
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    win.webContents.setUserAgent(userAgent)
    blockCustomProtocols(win)
    win.loadURL('https://www.douyin.com')

    win.on('closed', async () => {
      try {
        const cookies = await readDouyinCookies(ses)
        const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

        // 没登录就关窗时也有 ttwid / __ac_nonce 这类匿名 cookie，字符串非空；
        // 只有带会话的才算登录成功，否则会把原本有效的 Cookie 覆盖成匿名的
        const loggedIn = cookies.some((c) => LOGIN_COOKIE_NAMES.has(c.name))
        if (!loggedIn) {
          resolve('')
          return
        }

        // 先换指纹再换 Cookie：refreshDouyinHandler 会把新 device 灌给 polydl
        if (candidate) commitDeviceProfile(candidate)
        setSetting('douyin_cookie', cookieString)
        refreshDouyinHandler()
        lastRefreshTime = Date.now()

        resolve(cookieString)
      } catch (error) {
        reject(error)
      }
    })
  })
}

/**
 * 静默刷新 Cookie（后台自动模式）
 * 使用持久化 session，打开隐藏窗口加载抖音首页，等待页面加载完成后提取 Cookie
 */
export async function refreshDouyinCookieSilent(): Promise<string> {
  // 防止重复刷新
  if (isRefreshing) {
    console.log('[Cookie] Already refreshing, skip')
    return ''
  }

  // 检查刷新间隔
  const now = Date.now()
  if (now - lastRefreshTime < MIN_REFRESH_INTERVAL) {
    console.log('[Cookie] Refresh too frequent, skip')
    return ''
  }

  isRefreshing = true
  console.log('[Cookie] Starting silent refresh...')

  return new Promise((resolve) => {
    const partition = 'persist:douyin-login'
    const ses = session.fromPartition(partition)

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false, // 隐藏窗口
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    let resolved = false
    const cleanup = (): void => {
      if (!resolved) {
        resolved = true
        isRefreshing = false
        if (!win.isDestroyed()) {
          win.close()
        }
      }
    }

    // 超时处理（30秒）
    const timeout = setTimeout(() => {
      console.log('[Cookie] Silent refresh timeout')
      cleanup()
      resolve('')
    }, 30000)

    // 页面加载完成后等待一段时间让 JS 执行，然后提取 Cookie
    win.webContents.on('did-finish-load', async () => {
      console.log('[Cookie] Page loaded, waiting for cookies...')

      // 等待 3 秒让页面 JS 执行完成
      await new Promise((r) => setTimeout(r, 3000))

      try {
        const cookies = await readDouyinCookies(ses)
        const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

        // 分区里没有会话（从未登录 / 已登出）时只会拿到匿名 cookie，不能拿它覆盖有效的 Cookie
        const loggedIn = cookies.some((c) => LOGIN_COOKIE_NAMES.has(c.name))
        if (cookieString && loggedIn) {
          console.log('[Cookie] Silent refresh success, cookie length:', cookieString.length)
          setSetting('douyin_cookie', cookieString)
          refreshDouyinHandler()
          lastRefreshTime = Date.now()
          clearTimeout(timeout)
          cleanup()
          resolve(cookieString)
        } else {
          console.log(loggedIn ? '[Cookie] No cookies found' : '[Cookie] Not logged in, skip')
          clearTimeout(timeout)
          cleanup()
          resolve('')
        }
      } catch (error) {
        console.error('[Cookie] Silent refresh error:', error)
        clearTimeout(timeout)
        cleanup()
        resolve('')
      }
    })

    // 加载失败处理
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      console.error('[Cookie] Page load failed:', errorCode, errorDescription)
      clearTimeout(timeout)
      cleanup()
      resolve('')
    })

    win.webContents.setUserAgent(getBrowserUserAgent())
    blockCustomProtocols(win)
    win.loadURL('https://www.douyin.com')
  })
}

/**
 * 检查是否正在刷新
 */
/**
 * 浏览器复位：清空登录用的浏览器分区并清掉已保存的 Cookie。
 *
 * 分区里只要还留着会话，「从浏览器获取」就会沿用它、只把 Cookie 再导出一遍，
 * 被风控的旧会话永远换不掉。复位后下次登录是一个干净的窗口，会重新扫码并换一份设备指纹。
 * 已保存的 Cookie 也必须清：否则后台的抖音页面会把它重新注入分区，又回到「已登录」。
 */
export async function resetLoginBrowser(): Promise<void> {
  if (isRefreshing) {
    throw new Error('正在刷新 Cookie，请稍后再试')
  }
  closePage()
  const ses = session.fromPartition('persist:douyin-login')
  await ses.clearStorageData()
  await ses.clearCache()
  setSetting('douyin_cookie', '')
  refreshDouyinHandler()
  lastRefreshTime = 0
  console.log('[Cookie] 已复位登录浏览器，需重新登录')
}

export function isCookieRefreshing(): boolean {
  return isRefreshing
}

/**
 * 获取上次刷新时间
 */
export function getLastRefreshTime(): number {
  return lastRefreshTime
}
