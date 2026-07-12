import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  dialog,
  Tray,
  Menu,
  nativeImage,
  clipboard
} from 'electron'
import os from 'os'
import { join } from 'path'
import {
  existsSync,
  readdirSync,
  createWriteStream,
  createReadStream,
  statSync,
  cpSync,
  rmSync
} from 'fs'
import { mkdir, readdir, stat } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/trayTemplate.png?asset'
import {
  getDatabase,
  closeDatabase,
  initDatabase,
  getSetting,
  setSetting,
  getAllSettings,
  getAllUsers,
  getUserById,
  deleteUser,
  setUserShowInHome,
  updateUserSettings,
  batchUpdateUserSettings,
  getLiveRecords,
  deleteLiveRecord,
  resetStaleLiveStatus,
  createTask,
  getTaskById,
  getAllTasks,
  updateTask,
  updateTaskUsers,
  deleteTask,
  getAllPosts,
  getAllTags,
  type DbTask,
  type CreateTaskInput,
  type UpdateUserSettingsInput,
  type PostFilters,
  type PostSortConfig,
  deletePost,
  getPostsByUserId,
  fixAllPostTitles,
  deletePostsByUserId,
  getDashboardOverview,
  getDownloadTrend,
  getUserVideoDistribution,
  getTopTags,
  getContentLevelDistribution
} from './database'
import { fetchDouyinCookie, refreshDouyinCookieSilent, isCookieRefreshing } from './services/cookie'
import {
  initDouyinHandler,
  refreshDouyinHandler,
  fetchUserProfile,
  fetchVideoDetail,
  parseDouyinUrl,
  getSecUserId
} from './services/douyin'
import {
  startDownloadTask,
  stopDownloadTask,
  isTaskRunning,
  convertFolderImagesToJpg
} from './services/downloader'
import { addUserByUrl } from './services/user-add'
import {
  startAnalysis,
  stopAnalysis,
  isAnalysisRunning,
  reanalyzePost,
  reanalyzePosts
} from './services/analyzer'
import {
  blockCustomProtocols,
  attachProtocolGuards,
  isBlockedProtocol,
  isAllowedExternalProtocol
} from './utils/block-protocols'
import { initUpdater, registerUpdaterHandlers } from './services/updater'
import { initTelemetry, track } from './services/telemetry'
import {
  startUserSync,
  stopUserSync,
  isUserSyncing,
  getAnyUserSyncing,
  getAllSyncingUserIds
} from './services/syncer'
import {
  initScheduler,
  stopScheduler,
  scheduleUser,
  unscheduleUser,
  scheduleUserLive,
  unscheduleUserLive,
  scheduleTask,
  unscheduleTask,
  validateCronExpression,
  getSchedulerLogs,
  clearSchedulerLogs,
  scheduleCollectSync,
  executeCollectSync
} from './services/scheduler'
import {
  checkAndRecordUser,
  stopLiveRecording,
  stopAllLiveRecordings,
  isRecordingLive,
  getRecordingUserIds
} from './services/live-recorder'
import {
  getUnanalyzedPostsCount,
  getUnanalyzedPostsCountByUser,
  getUserAnalysisStats,
  getTotalAnalysisStats,
  getMigrationCount,
  getMigrationSecUids,
  batchReplacePaths,
  getTagOverviewStats,
  getUserTagStats,
  getTagLibraryStats,
  getTagsWithFrequency,
  getTagCategories,
  getPostsBySecUidForTags,
  getPostById,
  setPostTags,
  clearTags,
  renameTag,
  mergeTags,
  addCustomTag,
  type ClearTagScope
} from './database'
import { findCoverFile, findMediaFiles, fromUrlPath, getDownloadPath } from './services/media'
import { refreshUserProfile, getBatchRefreshDelay, sleep } from './services/user-refresh'
import {
  getWebServerInfo,
  startWebBrowserServer,
  stopWebBrowserServer
} from './services/web-browser'

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

// 遥测必须在 app ready 之前初始化（SDK 内部会调用 registerSchemesAsPrivileged 注册
// aptabase-ipc）。必须在下面我们自己的 registerSchemesAsPrivileged 之前调用：该 API 多次
// 调用会互相覆盖（仅最后一次生效），所以让 SDK 先注册、我们最后注册一个包含全部协议的完整
// 列表，避免 local 协议的 bypassCSP 被 SDK 覆盖导致 local:// 图片/视频被 CSP 拦截。
initTelemetry()

protocol.registerSchemesAsPrivileged([
  { scheme: 'local', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } },
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
app.whenReady().then(async () => {
  for (const scheme of ['bytedance', 'snssdk', 'aweme']) {
    protocol.handle(scheme, () => new Response('', { status: 400 }))
  }

  protocol.handle('local', async (request) => {
    const filePath = fromUrlPath(decodeURIComponent(request.url.replace('local://', '')))
    console.log('[local://] Request URL:', request.url)
    console.log('[local://] File path:', filePath)
    console.log('[local://] File exists:', existsSync(filePath))

    try {
      const fileStat = statSync(filePath)
      const fileSize = fileStat.size
      const rangeHeader = request.headers.get('Range')

      // 根据文件扩展名确定 MIME 类型
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      const mimeTypes: Record<string, string> = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        mov: 'video/quicktime',
        avi: 'video/x-msvideo',
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        wav: 'audio/wav',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif'
      }
      const contentType = mimeTypes[ext] || 'application/octet-stream'

      if (rangeHeader) {
        // 解析 Range 请求
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
          const chunkSize = end - start + 1

          const stream = createReadStream(filePath, { start, end })
          const chunks: Buffer[] = []
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk))
          }
          const buffer = Buffer.concat(chunks)

          return new Response(buffer, {
            status: 206,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes'
            }
          })
        }
      }

      // 无 Range 请求时返回完整文件
      // Windows 需要 file:/// 格式，并将反斜杠转换为正斜杠
      const fileUrl =
        process.platform === 'win32'
          ? `file:///${filePath.replace(/\\/g, '/')}`
          : `file://${filePath}`
      return net.fetch(fileUrl)
    } catch {
      return new Response('File not found', { status: 404 })
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

  // 初始化抖音客户端
  initDouyinHandler()

  // 初始化同步调度器
  initScheduler()

  // 注册更新 IPC handlers
  registerUpdaterHandlers()

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Settings IPC handlers
  ipcMain.handle('settings:get', (_event, key: string) => getSetting(key))
  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
    // 更新 cookie 时刷新抖音客户端
    if (key === 'douyin_cookie') {
      refreshDouyinHandler()
    }
  })
  ipcMain.handle('settings:getAll', () => getAllSettings())

  // Cookie IPC handlers
  ipcMain.handle('cookie:fetchDouyin', async () => {
    const cookie = await fetchDouyinCookie()
    // 获取到 cookie 后刷新抖音客户端
    if (cookie) {
      refreshDouyinHandler()
    }
    return cookie
  })
  ipcMain.handle('cookie:refreshSilent', async () => {
    const cookie = await refreshDouyinCookieSilent()
    return cookie
  })
  ipcMain.handle('cookie:isRefreshing', () => isCookieRefreshing())

  // Douyin IPC handlers
  ipcMain.handle('douyin:getUserProfile', (_event, url: string) => fetchUserProfile(url))
  ipcMain.handle('douyin:getSecUserId', (_event, url: string) => getSecUserId(url))
  ipcMain.handle('douyin:parseUrl', (_event, url: string) => parseDouyinUrl(url))

  // User IPC handlers
  ipcMain.handle('user:getAll', () => getAllUsers())
  ipcMain.handle('user:add', (_event, url: string) => addUserByUrl(url))
  ipcMain.handle('user:delete', (_event, id: number, deleteFiles?: boolean) => {
    const result = deleteUser(id)
    if (deleteFiles && result) {
      const downloadPath = getDownloadPath()
      const userDir = join(downloadPath, result.sec_uid)
      if (existsSync(userDir)) {
        rmSync(userDir, { recursive: true, force: true })
        console.log(`[User:delete] Removed files: ${userDir}`)
      }
    }
    return result
  })
  ipcMain.handle('user:setShowInHome', (_event, id: number, show: boolean) =>
    setUserShowInHome(id, show)
  )
  ipcMain.handle('user:updateSettings', (_event, id: number, input: UpdateUserSettingsInput) =>
    updateUserSettings(id, input)
  )
  ipcMain.handle(
    'user:batchUpdateSettings',
    (_event, ids: number[], input: Omit<UpdateUserSettingsInput, 'remark'>) =>
      batchUpdateUserSettings(ids, input)
  )
  ipcMain.handle('user:refresh', async (_event, id: number) => {
    const outcome = await refreshUserProfile(id)
    if (outcome.status === 'failed') {
      throw new Error(outcome.error || '获取用户信息失败')
    }
    return outcome.user
  })
  ipcMain.handle(
    'user:batchRefresh',
    async (_event, users: { id: number; homepage_url: string; nickname: string }[]) => {
      const results: { success: number; failed: number; details: string[] } = {
        success: 0,
        failed: 0,
        details: []
      }

      for (let i = 0; i < users.length; i++) {
        const u = users[i]
        const outcome = await refreshUserProfile(u.id)
        if (outcome.status === 'success') {
          results.success++
          results.details.push(`✅ ${outcome.user?.nickname || u.nickname}`)
        } else if (outcome.status === 'degraded') {
          // 疑似封号/冻结：已保留原昵称与头像
          results.success++
          results.details.push(`⚠️ ${u.nickname}: 疑似封号/冻结，已保留原名称与头像`)
        } else {
          results.failed++
          results.details.push(`❌ ${u.nickname}: ${outcome.error || '获取失败'}`)
        }
        // 限速：串行 + 随机间隔，规避风控（最后一个不再等待）
        if (i < users.length - 1) {
          await sleep(getBatchRefreshDelay())
        }
      }

      return results
    }
  )

  // Task IPC handlers
  ipcMain.handle('task:getAll', () => getAllTasks())
  ipcMain.handle('task:getById', (_event, id: number) => getTaskById(id))
  ipcMain.handle('task:create', (_event, input: CreateTaskInput) => createTask(input))
  ipcMain.handle(
    'task:update',
    (
      _event,
      id: number,
      input: Partial<{
        name: string
        status: string
        concurrency: number
        auto_sync: boolean
        sync_cron: string
      }>
    ) => {
      const dbInput: Parameters<typeof updateTask>[1] = {}
      if (input.name !== undefined) dbInput.name = input.name
      if (input.status !== undefined) dbInput.status = input.status as DbTask['status']
      if (input.concurrency !== undefined) dbInput.concurrency = input.concurrency
      if (input.auto_sync !== undefined) dbInput.auto_sync = input.auto_sync ? 1 : 0
      if (input.sync_cron !== undefined) dbInput.sync_cron = input.sync_cron
      return updateTask(id, dbInput)
    }
  )
  ipcMain.handle('task:updateUsers', (_event, taskId: number, userIds: number[]) =>
    updateTaskUsers(taskId, userIds)
  )
  ipcMain.handle('task:delete', (_event, id: number) => deleteTask(id))

  // Post IPC handlers
  ipcMain.handle(
    'post:getAll',
    (_event, page?: number, pageSize?: number, filters?: PostFilters, sort?: PostSortConfig) =>
      getAllPosts(page, pageSize, filters, sort)
  )
  ipcMain.handle('post:getAllTags', () => getAllTags())
  ipcMain.handle('post:getCoverPath', (_event, secUid: string, folderName: string) =>
    findCoverFile(secUid, folderName)
  )
  ipcMain.handle(
    'post:getMediaFiles',
    (_event, secUid: string, folderName: string, awemeType: number) =>
      findMediaFiles(secUid, folderName, awemeType)
  )
  ipcMain.handle('post:openFolder', (_event, secUid: string, folderName: string) => {
    const folderPath = join(getDownloadPath(), secUid, folderName)
    if (existsSync(folderPath)) {
      shell.openPath(folderPath)
    } else {
      // 如果具体文件夹不存在，打开用户目录
      const userPath = join(getDownloadPath(), secUid)
      if (existsSync(userPath)) {
        shell.openPath(userPath)
      }
    }
  })

  // Files management IPC handlers
  ipcMain.handle(
    'files:getUserPosts',
    (_event, userId: number, page?: number, pageSize?: number, sort?: PostSortConfig) =>
      getPostsByUserId(userId, page, pageSize, sort)
  )

  // 批量修复历史视频标题（从 _desc.txt 回填原始文案）
  ipcMain.handle('files:fixAllTitles', async () => {
    try {
      const result = fixAllPostTitles()
      return { success: true, result }
    } catch (error) {
      console.error('[IPC] fixAllTitles failed:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('files:getFileSizes', async (_event, secUid: string) => {
    const basePath = join(getDownloadPath(), secUid)
    if (!existsSync(basePath)) return { totalSize: 0, folderCount: 0 }
    let totalSize = 0
    let folderCount = 0
    try {
      // 用异步 fs 遍历，避免同步 statSync 阻塞主进程事件循环导致全局卡顿
      const folders = await readdir(basePath, { withFileTypes: true })
      for (const folder of folders) {
        if (!folder.isDirectory()) continue
        folderCount++
        const folderPath = join(basePath, folder.name)
        try {
          const files = await readdir(folderPath)
          const sizes = await Promise.all(
            files.map((file) =>
              stat(join(folderPath, file))
                .then((s) => s.size)
                .catch(() => 0)
            )
          )
          totalSize += sizes.reduce((sum, size) => sum + size, 0)
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
    return { totalSize, folderCount }
  })

  ipcMain.handle('files:getPostSize', (_event, secUid: string, folderName: string) => {
    const folderPath = join(getDownloadPath(), secUid, folderName)
    if (!existsSync(folderPath)) return 0
    let total = 0
    try {
      const files = readdirSync(folderPath)
      for (const file of files) {
        try {
          total += statSync(join(folderPath, file)).size
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
    return total
  })

  ipcMain.handle('files:deletePost', (_event, postId: number) => {
    const post = deletePost(postId)
    if (!post) return false
    const folderPath = join(getDownloadPath(), post.sec_uid, post.folder_name)
    if (existsSync(folderPath)) {
      rmSync(folderPath, { recursive: true, force: true })
    }
    return true
  })

  ipcMain.handle('files:deleteUserFiles', (_event, userId: number, secUid: string) => {
    const count = deletePostsByUserId(userId)
    const userDir = join(getDownloadPath(), secUid)
    if (existsSync(userDir)) {
      rmSync(userDir, { recursive: true, force: true })
    }
    return count
  })

  // Post integrity check & redownload IPC handlers
  ipcMain.handle('post:scanBroken', async () => {
    const { checkPostFileIntegrity } = await import('./services/download-validator')
    const { getPostsByUserIdAll } = await import('./database')
    const downloadPath = getDownloadPath()
    const results: {
      postId: number
      awemeId: string
      nickname: string
      folderPath: string
      reason: string
    }[] = []

    const users = getAllUsers()
    for (const user of users) {
      const posts = getPostsByUserIdAll(user.id)
      for (const post of posts) {
        const folderPath = join(downloadPath, user.sec_uid, post.folder_name)
        const { valid, reason } = checkPostFileIntegrity(folderPath, post.aweme_type)
        if (!valid) {
          results.push({
            postId: post.id,
            awemeId: post.aweme_id,
            nickname: post.nickname,
            folderPath,
            reason
          })
        }
      }
    }
    return results
  })

  ipcMain.handle('post:redownload', async (_event, awemeId: string) => {
    const { deletePostByAwemeId } = await import('./database')
    const { cleanupFailedDownload } = await import('./services/download-validator')

    const post = deletePostByAwemeId(awemeId)
    if (!post) throw new Error('作品记录不存在')

    if (post.video_path) {
      cleanupFailedDownload(post.video_path)
      if (existsSync(post.video_path)) {
        const files = readdirSync(post.video_path)
        const nonTmpFiles = files.filter((f) => !f.endsWith('.tmp'))
        if (nonTmpFiles.length === 0) {
          rmSync(post.video_path, { recursive: true, force: true })
        }
      }
    }

    return { success: true, message: '已删除记录，下次同步时将重新下载' }
  })

  ipcMain.handle('post:batchRedownload', async (_event, awemeIds: string[]) => {
    const { deletePostByAwemeId } = await import('./database')
    const { cleanupFailedDownload } = await import('./services/download-validator')

    let success = 0
    let failed = 0

    for (const awemeId of awemeIds) {
      try {
        const post = deletePostByAwemeId(awemeId)
        if (!post) {
          failed++
          continue
        }

        if (post.video_path) {
          cleanupFailedDownload(post.video_path)
          if (existsSync(post.video_path)) {
            const files = readdirSync(post.video_path)
            const nonTmpFiles = files.filter((f) => !f.endsWith('.tmp'))
            if (nonTmpFiles.length === 0) {
              rmSync(post.video_path, { recursive: true, force: true })
            }
          }
        }
        success++
      } catch {
        failed++
      }
    }

    return { success, failed }
  })

  // Database IPC handlers
  ipcMain.handle('db:execute', (_event, sql: string, params?: unknown[]) => {
    const db = getDatabase()
    const stmt = db.prepare(sql)
    return params ? stmt.run(...params) : stmt.run()
  })

  ipcMain.handle('db:query', (_event, sql: string, params?: unknown[]) => {
    const db = getDatabase()
    const stmt = db.prepare(sql)
    return params ? stmt.all(...params) : stmt.all()
  })

  ipcMain.handle('db:queryOne', (_event, sql: string, params?: unknown[]) => {
    const db = getDatabase()
    const stmt = db.prepare(sql)
    return params ? stmt.get(...params) : stmt.get()
  })

  // Download IPC handlers
  ipcMain.handle('download:start', (_event, taskId: number) => {
    track('download_started')
    return startDownloadTask(taskId)
  })
  ipcMain.handle('download:stop', (_event, taskId: number) => stopDownloadTask(taskId))
  ipcMain.handle('download:isRunning', (_event, taskId: number) => isTaskRunning(taskId))

  // Sync IPC handlers
  ipcMain.handle('sync:start', (_event, userId: number) => startUserSync(userId))
  ipcMain.handle('sync:stop', (_event, userId: number) => stopUserSync(userId))
  ipcMain.handle('sync:isRunning', (_event, userId: number) => isUserSyncing(userId))
  ipcMain.handle('sync:getAnySyncing', () => getAnyUserSyncing())
  ipcMain.handle('sync:getAllSyncing', () => getAllSyncingUserIds())
  ipcMain.handle('sync:validateCron', (_event, expression: string) =>
    validateCronExpression(expression)
  )
  ipcMain.handle('sync:updateUserSchedule', (_event, userId: number) => {
    const user = getUserById(userId)
    if (user) {
      if (user.auto_sync && user.sync_cron) {
        scheduleUser(user)
      } else {
        unscheduleUser(userId)
      }
    }
  })

  // Live recording IPC handlers
  ipcMain.handle('live:isRecording', (_event, userId: number) => isRecordingLive(userId))
  ipcMain.handle('live:getRecordingUsers', () => getRecordingUserIds())
  ipcMain.handle('live:checkNow', (_event, userId: number) => checkAndRecordUser(userId))
  ipcMain.handle('live:stop', (_event, userId: number) => stopLiveRecording(userId))
  ipcMain.handle('live:getRecords', (_event, limit?: number) => getLiveRecords(limit))
  ipcMain.handle('live:deleteRecord', (_event, id: number) => deleteLiveRecord(id))
  ipcMain.handle('live:revealFile', (_event, filePath: string) => {
    if (filePath) shell.showItemInFolder(filePath)
  })
  ipcMain.handle('live:updateUserSchedule', (_event, userId: number) => {
    const user = getUserById(userId)
    if (user) {
      if (user.live_record && user.live_check_cron) {
        scheduleUserLive(user)
      } else {
        unscheduleUserLive(userId)
      }
    }
  })

  // Task schedule update
  ipcMain.handle('task:updateSchedule', (_event, taskId: number) => {
    const task = getTaskById(taskId)
    if (task) {
      if (task.auto_sync && task.sync_cron) {
        scheduleTask(task)
      } else {
        unscheduleTask(taskId)
      }
    }
  })

  // Scheduler logs IPC handlers
  ipcMain.handle('scheduler:getLogs', () => getSchedulerLogs())
  ipcMain.handle('scheduler:clearLogs', () => clearSchedulerLogs())

  // 收藏同步：保存设置后重建定时任务 / 立即手动触发一次
  ipcMain.handle('collect:reschedule', () => scheduleCollectSync())
  ipcMain.handle('collect:syncNow', () => executeCollectSync())

  // Grok API verification
  ipcMain.handle('grok:verify', async (_event, apiKey: string, apiUrl: string, model: string) => {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5
      })
    })
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error?.message || response.statusText)
    }
    return true
  })

  // Analysis IPC handlers
  ipcMain.handle('analysis:start', (_event, secUid?: string) => {
    track('analysis_started')
    return startAnalysis(secUid)
  })
  ipcMain.handle('analysis:stop', () => stopAnalysis())
  ipcMain.handle('analysis:isRunning', () => isAnalysisRunning())
  ipcMain.handle('analysis:getUnanalyzedCount', (_event, secUid?: string) =>
    getUnanalyzedPostsCount(secUid)
  )
  ipcMain.handle('analysis:getUnanalyzedCountByUser', () => getUnanalyzedPostsCountByUser())
  ipcMain.handle('analysis:getUserStats', () => getUserAnalysisStats())
  ipcMain.handle('analysis:getTotalStats', () => getTotalAnalysisStats())
  ipcMain.handle('analysis:reanalyzePost', (_event, postId: number) => reanalyzePost(postId))
  ipcMain.handle('analysis:reanalyzePosts', (_event, postIds: number[]) => reanalyzePosts(postIds))

  // Tag management IPC handlers
  ipcMain.handle('tag:getOverviewStats', () => getTagOverviewStats())
  ipcMain.handle('tag:getUserStats', () => getUserTagStats())
  ipcMain.handle('tag:getLibraryStats', () => getTagLibraryStats())
  ipcMain.handle('tag:getTagsWithFrequency', () => getTagsWithFrequency())
  ipcMain.handle('tag:getCategories', () => getTagCategories())
  ipcMain.handle('tag:getPost', (_event, postId: number) => getPostById(postId))
  ipcMain.handle(
    'tag:getPostsByUser',
    (
      _event,
      secUid: string,
      filters?: { tags?: string[]; keyword?: string },
      page?: number,
      pageSize?: number
    ) => getPostsBySecUidForTags(secUid, filters, page, pageSize)
  )
  ipcMain.handle(
    'tag:setPostTags',
    (_event, postId: number, input: { aiTags?: string[]; manualTags?: string[] }) =>
      setPostTags(postId, input)
  )
  ipcMain.handle('tag:clear', (_event, postIds: number[], scope: ClearTagScope) =>
    clearTags(postIds, scope)
  )
  ipcMain.handle('tag:rename', (_event, oldName: string, newName: string) =>
    renameTag(oldName, newName)
  )
  ipcMain.handle('tag:merge', (_event, names: string[], into: string) => mergeTags(names, into))
  ipcMain.handle('tag:addCustomTag', (_event, name: string) => addCustomTag(name))

  // Video IPC handlers
  ipcMain.handle('video:getDetail', async (_event, url: string) => {
    const detail = (await fetchVideoDetail(url)) as {
      awemeId?: string
      awemeType?: number
      desc?: string
      nickname?: string
      cover?: string
      animatedCover?: string
      videoPlayAddr?: string[]
      images?: string[]
    }

    const isImages = detail.awemeType === 68
    const coverUrl = detail.cover || detail.animatedCover || ''

    return {
      awemeId: detail.awemeId || '',
      desc: detail.desc || '',
      nickname: detail.nickname || '',
      coverUrl,
      type: isImages ? 'images' : 'video',
      videoUrl: isImages ? undefined : detail.videoPlayAddr?.[0] || '',
      imageUrls: isImages ? detail.images || [] : undefined
    }
  })

  ipcMain.handle(
    'video:downloadToFolder',
    async (
      _event,
      info: {
        awemeId: string
        desc: string
        nickname: string
        type: 'video' | 'images'
        videoUrl?: string
        imageUrls?: string[]
      }
    ) => {
      const result = await dialog.showOpenDialog({
        title: '选择保存目录',
        properties: ['openDirectory', 'createDirectory']
      })

      if (result.canceled || !result.filePaths[0]) {
        throw new Error('已取消')
      }

      const savePath = result.filePaths[0]
      const folderName = `${info.nickname}_${info.awemeId}`
      const folderPath = join(savePath, folderName)

      await mkdir(folderPath, { recursive: true })

      const cookie = getSetting('douyin_cookie') || ''
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.douyin.com/',
        Cookie: cookie
      }

      if (info.type === 'video' && info.videoUrl) {
        const videoPath = join(folderPath, `${info.awemeId}.mp4`)
        const response = await fetch(info.videoUrl, { headers })
        if (!response.ok || !response.body) throw new Error('下载视频失败')
        const fileStream = createWriteStream(videoPath)
        await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream)
      } else if (info.type === 'images' && info.imageUrls) {
        for (let i = 0; i < info.imageUrls.length; i++) {
          const imgUrl = info.imageUrls[i]
          const ext = imgUrl.includes('.webp') ? 'webp' : 'jpg'
          const imgPath = join(folderPath, `${info.awemeId}_${i + 1}.${ext}`)
          const response = await fetch(imgUrl, { headers })
          if (!response.ok || !response.body) continue
          const fileStream = createWriteStream(imgPath)
          await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream)
        }
      }

      // 图文作品转 JPG
      if (info.type === 'images' && getSetting('convert_images_to_jpg') === 'true') {
        await convertFolderImagesToJpg(folderPath)
      }

      shell.openPath(folderPath)
    }
  )

  // Open data directory
  ipcMain.handle('system:openDataDirectory', () => {
    shell.openPath(app.getPath('userData'))
  })

  // Open URL in app browser (reuse douyin login session)
  ipcMain.handle('system:openInAppBrowser', (_event, url: string, title?: string) => {
    const partition = 'persist:douyin-login'
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      title: title || '抖音',
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true
      }
    })
    blockCustomProtocols(win)
    win.loadURL(url)
  })

  // Download path IPC handler
  ipcMain.handle('settings:getDefaultDownloadPath', () => {
    return join(app.getPath('userData'), 'Download', 'post')
  })

  // Dialog IPC handlers
  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择下载目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  // System resource IPC handlers
  let lastCpuInfo = os.cpus()

  ipcMain.handle('system:getResourceUsage', () => {
    // Calculate CPU usage
    const currentCpuInfo = os.cpus()

    let totalIdle = 0
    let totalTick = 0

    for (let i = 0; i < currentCpuInfo.length; i++) {
      const cpu = currentCpuInfo[i]
      const lastCpu = lastCpuInfo[i]

      const idleDiff = cpu.times.idle - lastCpu.times.idle
      const totalDiff =
        cpu.times.user -
        lastCpu.times.user +
        cpu.times.nice -
        lastCpu.times.nice +
        cpu.times.sys -
        lastCpu.times.sys +
        cpu.times.idle -
        lastCpu.times.idle +
        cpu.times.irq -
        lastCpu.times.irq

      totalIdle += idleDiff
      totalTick += totalDiff
    }

    lastCpuInfo = currentCpuInfo

    const cpuUsage = totalTick > 0 ? Math.round(((totalTick - totalIdle) / totalTick) * 100) : 0

    // Calculate memory usage
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const memoryUsage = Math.round((usedMem / totalMem) * 100)

    return {
      cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
      memoryUsage,
      memoryUsed: Math.round((usedMem / 1024 / 1024 / 1024) * 10) / 10,
      memoryTotal: Math.round((totalMem / 1024 / 1024 / 1024) * 10) / 10
    }
  })
  ipcMain.handle('system:getWebServerInfo', () => getWebServerInfo())

  // Migration IPC handler
  ipcMain.handle(
    'migration:execute',
    async (
      _event,
      oldPath: string,
      newPath: string
    ): Promise<{ success: number; failed: number; total: number }> => {
      const secUids = getMigrationSecUids(oldPath)
      const result = { success: 0, failed: 0, total: secUids.length }

      if (secUids.length === 0) return result

      const { rename: fsRename } = await import('fs/promises')
      await mkdir(newPath, { recursive: true })

      for (const secUid of secUids) {
        const sourceDir = join(oldPath, secUid)
        const targetDir = join(newPath, secUid)

        try {
          if (!existsSync(sourceDir)) {
            result.failed++
            continue
          }

          if (existsSync(targetDir)) {
            // Target exists: move individual post folders
            const entries = readdirSync(sourceDir, { withFileTypes: true })
            for (const entry of entries) {
              if (!entry.isDirectory()) continue
              const src = join(sourceDir, entry.name)
              const dst = join(targetDir, entry.name)
              if (existsSync(dst)) continue
              try {
                await fsRename(src, dst)
              } catch {
                cpSync(src, dst, { recursive: true })
                rmSync(src, { recursive: true, force: true })
              }
            }
            // Clean up empty source dir
            const remaining = readdirSync(sourceDir)
            if (remaining.length === 0) rmSync(sourceDir, { force: true })
          } else {
            // Move entire author directory
            try {
              await fsRename(sourceDir, targetDir)
            } catch {
              cpSync(sourceDir, targetDir, { recursive: true })
              rmSync(sourceDir, { recursive: true, force: true })
            }
          }

          result.success++
        } catch (error) {
          console.error(`[Migration] Failed to migrate ${secUid}:`, error)
          result.failed++
        }
      }

      // Batch update all paths in database
      batchReplacePaths(oldPath, newPath)

      return result
    }
  )

  // Migration count handler
  ipcMain.handle('migration:getCount', (_event, oldPath: string) => {
    return getMigrationCount(oldPath)
  })

  // Dashboard
  ipcMain.handle('dashboard:getOverview', () => getDashboardOverview())
  ipcMain.handle('dashboard:getDownloadTrend', (_event, days?: number) => getDownloadTrend(days))
  ipcMain.handle('dashboard:getUserDistribution', (_event, limit?: number) =>
    getUserVideoDistribution(limit)
  )
  ipcMain.handle('dashboard:getTopTags', (_event, limit?: number) => getTopTags(limit))
  ipcMain.handle('dashboard:getContentLevelDistribution', () => getContentLevelDistribution())

  try {
    const webInfo = await startWebBrowserServer()
    console.log('[Web] Server ready on port:', webInfo.port)
  } catch (error) {
    console.error('[Web] Failed to start video browser server:', error)
  }

  // 创建托盘图标
  createTray()

  // 创建主窗口
  mainWindow = createWindow()

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
})

// 应用退出前清理资源
app.on('before-quit', () => {
  isQuitting = true
  stopScheduler()
  stopAllLiveRecordings()
  void stopWebBrowserServer().catch((error) => {
    console.error('[Web] Failed to stop video browser server:', error)
  })
  closeDatabase()
})

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
