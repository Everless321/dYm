import { BrowserWindow, session } from 'electron'
import { setSetting } from '../../database'
import { blockCustomProtocols } from '../../utils/block-protocols'
import { BILIBILI_USER_AGENT, clearWbiCache } from './client'

const PARTITION = 'persist:bilibili-login'

/**
 * 打开哔哩哔哩登录窗口。关闭窗口时如果分区里有 SESSDATA，就写成 bili cookie。
 * 没登录就关窗时保留原来的 Cookie。
 */
export async function fetchBilibiliCookie(): Promise<string> {
  const ses = session.fromPartition(PARTITION)
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 1100,
      height: 760,
      title: '登录哔哩哔哩 - 登录后关闭此窗口',
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    win.webContents.setUserAgent(BILIBILI_USER_AGENT)
    blockCustomProtocols(win)
    win.loadURL('https://passport.bilibili.com/login')

    win.on('closed', async () => {
      try {
        const cookies = await ses.cookies.get({ url: 'https://www.bilibili.com' })
        const loggedIn = cookies.some((cookie) => cookie.name === 'SESSDATA' && cookie.value)
        if (!loggedIn) {
          resolve('')
          return
        }
        const cookieString = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
        setSetting('bilibili_cookie', cookieString)
        clearWbiCache()
        resolve(cookieString)
      } catch (error) {
        reject(error)
      }
    })
  })
}
