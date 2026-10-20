import { BrowserWindow, session } from 'electron'
import { setSetting } from '../../database'
import { blockCustomProtocols } from '../../utils/block-protocols'
import { installKuaishouClientHints, kuaishouUserAgent, prepareKuaishouWindow } from './page'

const PARTITION = 'persist:kuaishou-login'

/**
 * 打开快手网页。窗口使用和抖音同一套设备指纹与 Client Hints，
 * 否则首页会被快手直接拦住。关掉窗口时把会话 Cookie 写回。
 */
export async function fetchKuaishouCookie(): Promise<string> {
  const ses = session.fromPartition(PARTITION)
  const userAgent = kuaishouUserAgent()
  ses.setUserAgent(userAgent)
  installKuaishouClientHints(ses)
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      title: '打开快手 - 可登录后关闭此窗口',
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    void prepareKuaishouWindow(win).then(
      () => {
        blockCustomProtocols(win)
        if (!win.isDestroyed()) win.loadURL('https://www.kuaishou.com')
      },
      (error: Error) => {
        console.warn('[Kuaishou] 登录窗口指纹设置失败:', error.message)
        if (!win.isDestroyed()) win.loadURL('https://www.kuaishou.com')
      }
    )

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
