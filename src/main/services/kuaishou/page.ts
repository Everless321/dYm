import { BrowserWindow, session, type Session } from 'electron'
import { release } from 'os'
import { clientHintsOf, userAgentOf } from 'polydl'
import { getSetting } from '../../database'
import { blockCustomProtocols } from '../../utils/block-protocols'
import { applyClientHints } from '../douyin/client-hints'
import { getDeviceProfile } from '../douyin/device'
import {
  assertKuaishouAvailable,
  feedSignInput,
  interpretKuaishouResult,
  markKuaishouQuota,
  withKuaishouApiThrottle
} from './guard'

const PARTITION = 'persist:kuaishou-login'
const HOME_URL = 'https://www.kuaishou.com/'
const REALM_TIMEOUT_MS = 25_000
const PAGE_REQUEST_TIMEOUT_MS = 30_000
/** 比外层 executeJavaScript 超时更短，让页面里的 fetch 先自己中止 */
const PAGE_FETCH_TIMEOUT_MS = 25_000
const IDLE_CLOSE_MS = 5 * 60_000

/**
 * 在页面给 caver 赋值时抓住带 $encode 的对象。
 * 必须在页面脚本之前装上，否则签名环境一闪而过就抓不到。
 */
const SIGN_CAPTURE_SCRIPT = `
(() => {
  if (window.__ks_realm) return
  let done = false
  const setter = function (value) {
    if (!done && this && typeof this === 'object' && this !== window &&
        typeof this.$encode === 'function' && typeof this.$getCatVersion === 'function') {
      done = true
      window.__ks_realm = this
      try { delete Object.prototype.caver } catch (error) {}
    }
    Object.defineProperty(this, 'caver', {
      value, writable: true, enumerable: true, configurable: true
    })
  }
  try {
    Object.defineProperty(Object.prototype, 'caver', { set: setter, configurable: true })
  } catch (error) {}
})()
`

const hintedSessions = new WeakSet<Session>()
let win: BrowserWindow | null = null
let realmReady = false
let queue: Promise<unknown> = Promise.resolve()
let idleTimer: NodeJS.Timeout | null = null

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => closeKuaishouPage(), IDLE_CLOSE_MS)
}

export function closeKuaishouPage(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  realmReady = false
}

/** 给快手分区补上和抖音窗口同一套低熵 Client Hints。Electron 自己不发 sec-ch-ua。 */
export function installKuaishouClientHints(ses: Session): void {
  if (hintedSessions.has(ses)) return
  hintedSessions.add(ses)
  const hints = clientHintsOf(getDeviceProfile())
  ses.webRequest.onBeforeSendHeaders(
    {
      urls: ['*://*.kuaishou.com/*', '*://*.kuaishou.cn/*', '*://*.chenzhongtech.com/*']
    },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          'sec-ch-ua': hints['Sec-Ch-Ua'],
          'sec-ch-ua-mobile': hints['Sec-Ch-Ua-Mobile'],
          'sec-ch-ua-platform': hints['Sec-Ch-Ua-Platform']
        }
      })
    }
  )
}

export function kuaishouUserAgent(): string {
  return userAgentOf(getDeviceProfile())
}

/** 登录窗口和签名窗口共用：设备指纹要在 loadURL 之前落地。 */
export async function prepareKuaishouWindow(target: BrowserWindow): Promise<void> {
  const profile = getDeviceProfile()
  const userAgent = userAgentOf(profile)
  target.webContents.setUserAgent(userAgent)
  await applyClientHints(target.webContents, profile, release())
}

async function injectCookies(ses: Session): Promise<void> {
  const raw = getSetting('kuaishou_cookie')
  if (!raw) return
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    try {
      await ses.cookies.set({
        url: 'https://www.kuaishou.com',
        name,
        value: part.slice(eq + 1).trim(),
        domain: '.kuaishou.com',
        path: '/',
        secure: true
      })
    } catch {
      // 个别名字写不进分区就跳过
    }
  }
}

async function installCaptureScript(target: BrowserWindow): Promise<void> {
  try {
    if (!target.webContents.debugger.isAttached()) target.webContents.debugger.attach('1.3')
    await target.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: SIGN_CAPTURE_SCRIPT
    })
  } catch (error) {
    console.warn('[Kuaishou] 签名捕获脚本没有装上:', (error as Error).message)
  }
}

async function ensurePage(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed() && realmReady) {
    scheduleIdleClose()
    return win
  }
  closeKuaishouPage()
  const ses = session.fromPartition(PARTITION)
  const userAgent = kuaishouUserAgent()
  ses.setUserAgent(userAgent)
  installKuaishouClientHints(ses)
  await injectCookies(ses)

  const created = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      partition: PARTITION,
      // 和抖音页内签名一样：关隔离才能碰到页面自己的 $encode
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      // 隐藏窗口默认会拖慢定时器，页内 25 秒中止会晚于外层超时
      backgroundThrottling: false
    }
  })
  await prepareKuaishouWindow(created)
  await installCaptureScript(created)
  blockCustomProtocols(created)
  created.loadURL(HOME_URL).catch(() => {})
  win = created
  try {
    await waitForRealm(created)
    realmReady = true
  } catch (error) {
    closeKuaishouPage()
    throw error
  }
  scheduleIdleClose()
  return created
}

async function waitForRealm(target: BrowserWindow): Promise<void> {
  const deadline = Date.now() + REALM_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (target.isDestroyed()) throw new Error('快手页面窗口已关闭')
    const ready = (await target.webContents
      .executeJavaScript('Boolean(window.__ks_realm)')
      .catch(() => false)) as boolean
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('快手页面没有准备好 $encode 签名环境，请检查网络后重试')
}

function runInPage(target: BrowserWindow, script: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settle()
    }
    const timer = setTimeout(() => {
      finish(() => {
        // 页内脚本还没结束就关掉窗口，避免下一次请求和它叠在同一个页面上
        closeKuaishouPage()
        reject(new Error('快手页面请求超时'))
      })
    }, PAGE_REQUEST_TIMEOUT_MS)
    target.webContents
      .executeJavaScript(script)
      .then((value) => finish(() => resolve(value)))
      .catch((error: Error) => finish(() => reject(error)))
  })
}

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

export async function fetchTextInPage(url: string): Promise<string> {
  return withKuaishouApiThrottle(() =>
    serialize(async () => {
      assertKuaishouAvailable()
      const target = await ensurePage()
      const script = `
        (async () => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), ${PAGE_FETCH_TIMEOUT_MS})
          try {
            const response = await fetch(${JSON.stringify(url)}, {
              credentials: 'include',
              redirect: 'follow',
              signal: controller.signal
            })
            return { url: response.url, status: response.status, text: await response.text() }
          } finally {
            clearTimeout(timer)
          }
        })()
      `
      const result = (await runInPage(target, script)) as {
        url: string
        status: number
        text: string
      }
      if (result.status >= 400) throw new Error(`快手页面 HTTP ${result.status}`)
      return result.text
    })
  )
}

export async function resolveInPage(url: string): Promise<string> {
  return withKuaishouApiThrottle(() =>
    serialize(async () => {
      assertKuaishouAvailable()
      const target = await ensurePage()
      const script = `
        (async () => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), ${PAGE_FETCH_TIMEOUT_MS})
          try {
            const response = await fetch(${JSON.stringify(url)}, {
              credentials: 'include',
              redirect: 'follow',
              signal: controller.signal
            })
            return response.url || ${JSON.stringify(url)}
          } finally {
            clearTimeout(timer)
          }
        })()
      `
      return (await runInPage(target, script)) as string
    })
  )
}

export async function fetchSignedProfileFeed(
  userId: string,
  cursor: string
): Promise<Record<string, unknown>> {
  return withKuaishouApiThrottle(() =>
    serialize(async () => {
      assertKuaishouAvailable()
      const target = await ensurePage()
      const input = feedSignInput(userId, cursor)
      const script = `
        (async () => {
          const input = ${JSON.stringify(input)}
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), ${PAGE_FETCH_TIMEOUT_MS})
          try {
            const sign = await new Promise((resolve, reject) => {
              const fail = () => reject(new Error('快手签名超时'))
              if (controller.signal.aborted) {
                fail()
                return
              }
              controller.signal.addEventListener('abort', fail, { once: true })
              window.__ks_realm.call('$encode', [
                input,
                { suc: (value) => resolve(value), err: (error) => reject(new Error(String(error))) }
              ])
            })
            const response = await fetch(
              'https://www.kuaishou.com/rest/v/profile/feed?__NS_hxfalcon=' + encodeURIComponent(sign) + '&caver=2',
              {
                method: 'POST',
                credentials: 'include',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(input.requestBody),
                signal: controller.signal
              }
            )
            return await response.json()
          } finally {
            clearTimeout(timer)
          }
        })()
      `
      const payload = (await runInPage(target, script)) as {
        result?: unknown
        error_msg?: unknown
        feeds?: unknown
      }
      const decision = interpretKuaishouResult(payload)
      if (decision.kind === 'quota') markKuaishouQuota()
      if (decision.kind === 'unsigned') {
        throw new Error('快手投稿接口签名验证失败。页面里的 $encode 没有签上这次请求')
      }
      if (decision.kind === 'error') throw new Error(decision.message)
      return payload as Record<string, unknown>
    })
  )
}
