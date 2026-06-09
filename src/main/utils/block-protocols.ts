import { BrowserWindow, WebContents } from 'electron'

const BLOCKED_PROTOCOLS = ['bytedance:', 'snssdk:', 'aweme:']
const ALLOWED_EXTERNAL_PROTOCOLS = ['http:', 'https:', 'mailto:']

export function isBlockedProtocol(url: string): boolean {
  const lower = url.toLowerCase()
  return BLOCKED_PROTOCOLS.some((p) => lower.startsWith(p))
}

export function isAllowedExternalProtocol(url: string): boolean {
  const lower = url.toLowerCase()
  return ALLOWED_EXTERNAL_PROTOCOLS.some((p) => lower.startsWith(p))
}

function attachGuards(contents: WebContents): void {
  contents.on('will-navigate', (event, url) => {
    if (isBlockedProtocol(url)) event.preventDefault()
  })

  // iframe 内的导航：抖音页面里的"打开 App"按钮通常在 iframe 中触发 deep link
  contents.on('will-frame-navigate', (event) => {
    if (isBlockedProtocol(event.url)) event.preventDefault()
  })

  contents.setWindowOpenHandler(({ url }) => {
    if (isBlockedProtocol(url) || !isAllowedExternalProtocol(url)) {
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
}

export function blockCustomProtocols(win: BrowserWindow): void {
  attachGuards(win.webContents)
}

export function attachProtocolGuards(contents: WebContents): void {
  attachGuards(contents)
}
