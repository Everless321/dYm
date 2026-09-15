import { BrowserWindow, session } from 'electron'
import { setSetting } from '../../database'
import { refreshDouyinHandler } from './client'
import { blockCustomProtocols } from '../../utils/block-protocols'
import { CHROME_UA } from '../../utils/user-agent'

// Cookie 刷新状态
let isRefreshing = false
let lastRefreshTime = 0
const MIN_REFRESH_INTERVAL = 30000 // 最小刷新间隔 30 秒
/** 只有这些会话 cookie 之一存在才算真正登录了抖音 */
const LOGIN_COOKIE_NAMES = new Set(['sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard'])

/**
 * 打开浏览器窗口让用户登录获取 Cookie（手动模式）
 */
export async function fetchDouyinCookie(): Promise<string> {
  return new Promise((resolve, reject) => {
    const partition = 'persist:douyin-login'
    const ses = session.fromPartition(partition)

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

    win.webContents.setUserAgent(CHROME_UA)
    blockCustomProtocols(win)
    win.loadURL('https://www.douyin.com')

    win.on('closed', async () => {
      try {
        const cookies = await ses.cookies.get({ domain: '.douyin.com' })
        const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

        // 没登录就关窗时也有 ttwid / __ac_nonce 这类匿名 cookie，字符串非空；
        // 只有带会话的才算登录成功，否则会把原本有效的 Cookie 覆盖成匿名的
        const loggedIn = cookies.some((c) => LOGIN_COOKIE_NAMES.has(c.name))
        if (!loggedIn) {
          resolve('')
          return
        }

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
        const cookies = await ses.cookies.get({ domain: '.douyin.com' })
        const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ')

        if (cookieString) {
          console.log('[Cookie] Silent refresh success, cookie length:', cookieString.length)
          setSetting('douyin_cookie', cookieString)
          refreshDouyinHandler()
          lastRefreshTime = Date.now()
          clearTimeout(timeout)
          cleanup()
          resolve(cookieString)
        } else {
          console.log('[Cookie] No cookies found')
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

    win.webContents.setUserAgent(CHROME_UA)
    blockCustomProtocols(win)
    win.loadURL('https://www.douyin.com')
  })
}

/**
 * 检查是否正在刷新
 */
export function isCookieRefreshing(): boolean {
  return isRefreshing
}

/**
 * 获取上次刷新时间
 */
export function getLastRefreshTime(): number {
  return lastRefreshTime
}
