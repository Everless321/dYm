import { BrowserWindow, session } from 'electron'
import { setSetting } from '../database'
import { refreshDouyinHandler } from './douyin'
import { blockCustomProtocols } from '../utils/block-protocols'

// Cookie 刷新状态
let isRefreshing = false
let lastRefreshTime = 0
const MIN_REFRESH_INTERVAL = 30000 // 最小刷新间隔 30 秒

/**
 * 抹掉 UA 里的 Electron 标识。抖音页面会把 UA 解析成 browser_name / browser_version
 * 写进每个接口请求的参数里，不改的话就是在自报 browser_name=Electron。
 */
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

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

        if (cookieString) {
          setSetting('douyin_cookie', cookieString)
          refreshDouyinHandler()
          lastRefreshTime = Date.now()
        }

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
