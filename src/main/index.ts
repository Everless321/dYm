import {
  app,
  shell,
  dialog,
  BrowserWindow,
  protocol,
  Tray,
  Menu,
  nativeImage,
  clipboard
} from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/trayTemplate.png?asset'
import {
  closeDatabase,
  initDatabase,
  resetStaleLiveStatus,
  resetStaleSyncStatus,
  resetStaleTaskStatus
} from './database'
import { initDouyinHandler } from './services/douyin'
import {
  blockCustomProtocols,
  attachProtocolGuards,
  isBlockedProtocol,
  isAllowedExternalProtocol
} from './utils/block-protocols'
import { initUpdater, registerUpdaterHandlers } from './services/updater'
import { initTelemetry, track } from './services/telemetry'
import { initScheduler, stopScheduler } from './services/scheduler'
import { closePage } from './services/douyin-page'
import { hasRunningLiveRecordings, stopAllLiveRecordings } from './services/live-recorder'
import { sweepUnconverted } from './services/live-convert'
import { fromUrlPath } from './services/media'
import { startScriptHooks } from './services/scripts/hooks'
import {
  getWebServerInfo,
  startWebBrowserServer,
  stopWebBrowserServer
} from './services/web-browser'
import { registerIpcHandlers } from './ipc'

// 放开 Node fetch(undici)的 TLS 证书校验。
// 原因：本地 HTTPS 代理（如 Surge）开启 MITM 解密时会注入自签名根证书，
// Node 默认证书库不信任它，导致抖音 API 请求报 SELF_SIGNED_CERT_IN_CHAIN / 网络连接失败。
// 经用户确认接受此安全代价，换取在抓包/代理环境下也能正常请求。
// 必须在任何网络请求发生前设置。
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// 全局变量
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let lastDetectedLink = '' // 记录上次检测的抖音链接
let lastDetectedTime = 0 // 上次检测时间
let clipboardCheckTimer: NodeJS.Timeout | null = null // 防抖计时器
const LINK_COOLDOWN = 30000 // 同一链接30秒内不重复提示
const DEBOUNCE_DELAY = 500 // 防抖延迟500ms

// 抖音链接正则匹配
const douyinLinkPatterns = [
  /https?:\/\/v\.douyin\.com\/\S+/i,
  /https?:\/\/www\.douyin\.com\/user\/\S+/i,
  /https?:\/\/www\.douyin\.com\/video\/\S+/i,
  /https?:\/\/www\.iesdouyin\.com\/share\/user\/\S+/i,
  /https?:\/\/www\.iesdouyin\.com\/share\/video\/\S+/i
]

// 检测文本中是否包含抖音链接
function extractDouyinLink(text: string): string | null {
  for (const pattern of douyinLinkPatterns) {
    const match = text.match(pattern)
    if (match) return match[0]
  }
  return null
}

function createTray(): void {
  console.log('[Tray] Creating tray, platform:', process.platform)

  // macOS 使用专用托盘图标，其他平台使用应用图标
  const iconPath = process.platform === 'darwin' ? trayIcon : icon
  console.log('[Tray] Icon path:', iconPath)

  const image = nativeImage.createFromPath(iconPath)

  if (image.isEmpty()) {
    console.error('[Tray] Failed to load icon from:', iconPath)
    // 回退到应用图标
    const fallback = nativeImage.createFromPath(icon)
    if (fallback.isEmpty()) {
      console.error('[Tray] Fallback icon also failed')
      return
    }
    tray = new Tray(fallback.resize({ width: 16, height: 16 }))
  } else {
    // macOS 托盘图标推荐 18x18（Retina 屏幕会自动使用 @2x）
    const size = process.platform === 'darwin' ? 18 : 16
    tray = new Tray(image.resize({ width: size, height: size }))
  }

  console.log('[Tray] Tray created successfully')

  const webInfo = getWebServerInfo()
  const lanUrls = webInfo.urls.filter(
    (url) => !url.includes('127.0.0.1') && !url.includes('localhost')
  )
  const copyUrls = lanUrls.length > 0 ? lanUrls : webInfo.urls

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: `网页端端口：${webInfo.port}`,
      enabled: false
    },
    {
      label: '打开网页端',
      enabled: webInfo.started,
      click: () => {
        shell.openExternal(webInfo.origin)
      }
    },
    {
      label: '复制网页地址',
      enabled: webInfo.started,
      click: () => {
        clipboard.writeText(copyUrls.join('\n'))
      }
    },
    {
      label: '局域网地址',
      enabled: copyUrls.length > 0,
      submenu: copyUrls.map((url) => ({
        label: url,
        click: () => clipboard.writeText(url)
      }))
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('dYm - 抖音视频下载器')
  tray.setContextMenu(contextMenu)

  // 点击托盘图标显示窗口
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus()
      } else {
        mainWindow.show()
      }
    }
  })
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 拦截关闭事件，询问用户是否进入后台
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['最小化到托盘', '退出程序'],
        defaultId: 0,
        cancelId: 0,
        title: '关闭窗口',
        message: '您想要最小化到系统托盘还是退出程序？'
      })
      if (choice === 1) {
        isQuitting = true
        app.quit()
      } else {
        mainWindow.hide()
      }
    }
  })

  blockCustomProtocols(mainWindow)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isBlockedProtocol(details.url) || !isAllowedExternalProtocol(details.url)) {
      return { action: 'deny' }
    }
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 监听窗口获得焦点，检测剪贴板中的抖音链接
  mainWindow.on('focus', () => {
    // 防抖：清除之前的计时器，延迟500ms后检测
    if (clipboardCheckTimer) {
      clearTimeout(clipboardCheckTimer)
    }
    clipboardCheckTimer = setTimeout(() => {
      const clipboardText = clipboard.readText()
      if (!clipboardText) return

      const douyinLink = extractDouyinLink(clipboardText)
      if (douyinLink) {
        const now = Date.now()
        // 同一链接在冷却时间内不重复提示
        if (douyinLink === lastDetectedLink && now - lastDetectedTime < LINK_COOLDOWN) {
          return
        }
        lastDetectedLink = douyinLink
        lastDetectedTime = now
        // 通知渲染进程检测到抖音链接
        mainWindow?.webContents.send('clipboard-douyin-link', douyinLink)
      }
    }, DEBOUNCE_DELAY)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// 曾经在此设置 disable-accelerated-video-decode，用于绕开直播录制转封装流上
// VideoToolbox 硬解报 -12909（bad data）的问题。但该开关是进程级的，副作用是
// 彻底禁掉 HEVC：macOS 上 Chromium 只有硬解路径能解 H.265，没有软解兜底，
// 于是抖音下发的 HEVC 作品（本机 61 个里有 9 个）音频正常、画面全黑。
//
// Electron 39 上重新验证：全部 4 条录制（含 ORIGIN 原画）在硬解下均正常播放，
// 1920x1080 实时推进、无 -12909、无 stall，故移除该开关。
// 若 -12909 再次出现，正确做法是对出问题的文件用内置 ffmpeg 转码成 H.264，
// 而不是用进程级开关关掉整个硬解路径。

// 遥测必须在 app ready 之前初始化（SDK 内部会调用 registerSchemesAsPrivileged 注册
// aptabase-ipc）。必须在下面我们自己的 registerSchemesAsPrivileged 之前调用：该 API 多次
// 调用会互相覆盖（仅最后一次生效），所以让 SDK 先注册、我们最后注册一个包含全部协议的完整
// 列表，避免 local 协议的 bypassCSP 被 SDK 覆盖导致 local:// 图片/视频被 CSP 拦截。
initTelemetry()

protocol.registerSchemesAsPrivileged([
  // standard: true 必需 — 否则 Chromium 媒体栈对 local:// 的分段(Range)加载失效，
  // <video> seek/长视频播放会报 PIPELINE_ERROR_READ: FFmpegDemuxer: data source error。
  // standard scheme 的 URL 必须带 host，统一用固定 host「file」：local://file/abs/path
  {
    scheme: 'local',
    privileges: { standard: true, bypassCSP: true, stream: true, supportFetchAPI: true }
  },
  { scheme: 'bytedance', privileges: {} },
  { scheme: 'snssdk', privileges: {} },
  { scheme: 'aweme', privileges: {} },
  // 与 Aptabase SDK 内部注册保持一致，确保覆盖后 aptabase-ipc 仍具备所需特权
  {
    scheme: 'aptabase-ipc',
    privileges: { bypassCSP: true, corsEnabled: true, supportFetchAPI: true, secure: true }
  }
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// 单实例：双开会让两个进程共享 data.db、cron 双份跑、ffmpeg 写两份文件。
// 拿不到锁必须用 app.exit 立刻结束：app.quit() 在 ready 之前只是排队，ready 仍会触发、
// bootstrap 的同步部分（initDatabase、resetStale* 把主实例正在录制/同步的状态改掉）会跑完才退
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

async function bootstrap(): Promise<void> {
  for (const scheme of ['bytedance', 'snssdk', 'aweme']) {
    protocol.handle(scheme, () => new Response('', { status: 400 }))
  }

  // 用 registerFileProtocol（而非 protocol.handle）：交给 Chromium 原生 file loader，
  // MIME/Range/206 全部原生处理，<video> 才能正确 seek。protocol.handle 的自定义
  // Response 对二次 Range 请求有已知 bug（electron#38749），seek 必报 PIPELINE_ERROR_READ。
  protocol.registerFileProtocol('local', (request, callback) => {
    try {
      const u = new URL(request.url)
      // 标准形式 local://file/abs/path → pathname 即路径（大小写保真）；
      // 兜底：无「file」host 的旧形式 URL，首段路径会被解析成 host（已小写化）
      const urlPath = u.hostname === 'file' ? u.pathname : `/${u.hostname}${u.pathname}`
      const filePath = fromUrlPath(decodeURIComponent(urlPath))
      if (!existsSync(filePath)) {
        callback({ error: -6 }) // net::ERR_FILE_NOT_FOUND
        return
      }
      callback({ path: filePath })
    } catch {
      callback({ error: -6 })
    }
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 全局拦截所有 webContents（包括子窗口、iframe）的自定义协议跳转
  app.on('web-contents-created', (_event, contents) => {
    attachProtocolGuards(contents)
  })

  // 初始化数据库
  initDatabase()

  // 统计启动次数（匿名，可在系统设置关闭）
  track('app_started')

  // 清理上次异常退出遗留的「录制中」脏状态
  resetStaleLiveStatus()
  resetStaleSyncStatus()
  resetStaleTaskStatus()

  // 初始化抖音客户端
  initDouyinHandler()

  // 初始化同步调度器
  initScheduler()

  // 脚本钩子：听下载 / 分析 / 录播完成事件
  startScriptHooks()

  // 注册更新 IPC handlers
  registerUpdaterHandlers()

  // 注册全部业务 IPC handler（按领域拆分在 ipc/ 目录）
  registerIpcHandlers()

  // 创建托盘图标
  createTray()

  // 创建主窗口：窗口不依赖 web 服务与历史录像扫描，先把界面亮出来
  mainWindow = createWindow()

  try {
    const webInfo = await startWebBrowserServer()
    console.log('[Web] Server ready on port:', webInfo.port)
  } catch (error) {
    console.error('[Web] Failed to start video browser server:', error)
  }

  // 补扫未转换的历史录制（异常退出/转换失败遗留的 FLV），后台串行转换。
  // 延后几秒：转封装是磁盘密集操作，别和首屏加载抢 IO
  setTimeout(() => {
    try {
      sweepUnconverted()
    } catch (error) {
      console.error('[LiveConvert] 补扫历史录制失败:', error)
    }
  }, 5000)

  // 初始化自动更新（仅在生产环境）
  if (!is.dev) {
    initUpdater(mainWindow)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow) {
      mainWindow.show()
    } else {
      mainWindow = createWindow()
      if (!is.dev) {
        initUpdater(mainWindow)
      }
    }
  })
}

// 启动链任何一步抛错（典型是 data.db 损坏 / userData 不可写）都要让用户看到，
// 否则没有窗口、没有托盘，进程静默挂着，用户只会觉得「双击没反应」
if (hasSingleInstanceLock) {
  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      console.error('[App] 启动失败:', error)
      dialog.showErrorBox(
        '启动失败',
        `${(error as Error).message || String(error)}\n\n数据目录：${app.getPath('userData')}`
      )
      app.exit(1)
    })
}

// 应用退出前清理资源。
// 有录制在跑时先拦一次退出：SIGINT 之后 ffmpeg 要写完文件、finishRecording 要落库，
// 都等完（或超时）再真正退出，否则 FLV 尾部损坏、记录停在 recording。
let quitCleanupDone = false
app.on('before-quit', (event) => {
  isQuitting = true
  if (quitCleanupDone) return

  if (hasRunningLiveRecordings()) {
    event.preventDefault()
    stopScheduler()
    closePage()
    void stopAllLiveRecordings()
      .catch((error) => console.error('[Live] 退出时停止录制失败:', error))
      .finally(() => {
        quitCleanupDone = true
        finishQuitCleanup()
        app.quit()
      })
    return
  }

  quitCleanupDone = true
  stopScheduler()
  closePage()
  finishQuitCleanup()
})

function finishQuitCleanup(): void {
  void stopWebBrowserServer().catch((error) => {
    console.error('[Web] Failed to stop video browser server:', error)
  })
  try {
    closeDatabase()
  } catch (error) {
    console.error('[Database] 关闭数据库失败:', error)
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
