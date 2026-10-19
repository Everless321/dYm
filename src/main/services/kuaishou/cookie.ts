import { BrowserWindow, session } from 'electron'
import { setSetting } from '../../database'
import { blockCustomProtocols } from '../../utils/block-protocols'
import { KUAISHOU_USER_AGENT } from './client'

const PARTITION = 'persist:kuaishou-login'

/**
 * 打开快手网页。KS-Downloader 的 Cookie 不要求登录，
 * 但浏览器访问后拿到的 did 等会话能让投稿接口更稳定。关掉窗口时写回。
 */
export async function fetchKuaishouCookie(): Promise<string> {
  const ses = session.fromPartition(PARTITION)
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
    win.webContents.setUserAgent(KUAISHOU_USER_AGENT)
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
