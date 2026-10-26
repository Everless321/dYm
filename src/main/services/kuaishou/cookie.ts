import { BrowserWindow, session } from 'electron'
import { release } from 'os'
import { userAgentOf } from 'polydl'
import { setSetting } from '../../database'
import { blockCustomProtocols } from '../../utils/block-protocols'
import { applyClientHints, installClientHintHeaders } from '../douyin/client-hints'
import { getDeviceProfile } from '../douyin/device'

const PARTITION = 'persist:kuaishou-login'
const KUAISHOU_URLS = ['*://*.kuaishou.com/*', '*://*.kuaishou.cn/*']

/**
 * 打开快手网页让用户扫码登录，关掉窗口时把 Cookie 写回设置。
 * 指纹沿用抖音那套设备画像：polydl 请求时用同一个 UA，登录态和请求头才对得上。
 * 与抖音登录窗口一样不等 CDP 命令：页面加载前发出的调试命令不会返回。
 */
export async function fetchKuaishouCookie(): Promise<string> {
  const ses = session.fromPartition(PARTITION)
  const profile = getDeviceProfile()
  installClientHintHeaders(ses, profile, KUAISHOU_URLS)

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      title: '登录快手 - 登录后关闭此窗口',
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    win.webContents.setUserAgent(userAgentOf(profile))
    applyClientHints(win.webContents, profile, release())
    blockCustomProtocols(win)
    win.loadURL('https://www.kuaishou.com')

    win.on('closed', async () => {
      try {
        const cookies = await ses.cookies.get({ url: 'https://www.kuaishou.com' })
        if (cookies.length === 0) {
          resolve('')
          return
        }
        const cookieString = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
        setSetting('kuaishou_cookie', cookieString)
        resolve(cookieString)
      } catch (error) {
        reject(error)
      }
    })
  })
}
