import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { blockCustomProtocols } from '../utils/block-protocols'

// 直播回放播放器窗口（独立 HTML 入口，自带宽松 CSP 以支持 FLV/MSE 的 blob:）。
// 通过 hash 传 recordId，渲染端据此拉取记录并播放。
export function createLivePlayerWindow(recordId: number): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: '直播回放',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  blockCustomProtocols(win)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/live-player.html#${recordId}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/live-player.html'), { hash: String(recordId) })
  }
}
