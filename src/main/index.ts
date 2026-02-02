import { app, shell, BrowserWindow, ipcMain, protocol, net, dialog } from 'electron'
import os from 'os'
import { join } from 'path'
import { existsSync, readdirSync, createWriteStream, createReadStream, statSync, cpSync, rmSync } from 'fs'
import { mkdir } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  getDatabase,
  closeDatabase,
  initDatabase,
  getSetting,
  setSetting,
  getAllSettings,
  createUser,
  getAllUsers,
  getUserById,
  getUserBySecUid,
  deleteUser,
  setUserShowInHome,
  updateUserSettings,
  batchUpdateUserSettings,
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
  type PostFilters
} from './database'
import { fetchDouyinCookie, refreshDouyinCookieSilent, isCookieRefreshing } from './services/cookie'
import {
  initDouyinHandler,
  refreshDouyinHandler,
  fetchUserProfile,
  fetchUserProfileBySecUid,
  fetchVideoDetail,
  parseDouyinUrl,
  getSecUserId
} from './services/douyin'
import { startDownloadTask, stopDownloadTask, isTaskRunning } from './services/downloader'
import { startAnalysis, stopAnalysis, isAnalysisRunning } from './services/analyzer'
import { initUpdater, registerUpdaterHandlers } from './services/updater'
import { startUserSync, stopUserSync, isUserSyncing, getAnyUserSyncing } from './services/syncer'
import { initScheduler, stopScheduler, scheduleUser, unscheduleUser, scheduleTask, unscheduleTask, validateCronExpression } from './services/scheduler'
import {
  getUnanalyzedPostsCount,
  getUnanalyzedPostsCountByUser,
  getUserAnalysisStats,
  getTotalAnalysisStats,
  getPostsForMigration,
  updatePostPaths
} from './database'

function getDownloadPath(): string {
  return join(app.getPath('userData'), 'Download', 'post')
}

// 将路径转换为 URL 友好格式（Windows 反斜杠转正斜杠，并添加前导斜杠）
function toUrlPath(filePath: string): string {
  if (process.platform === 'win32') {
    // Windows: C:\Users\xxx -> /C:/Users/xxx (添加前导斜杠使 URL 正确解析)
    return '/' + filePath.replace(/\\/g, '/')
  }
  return filePath
}

interface MediaFiles {
  type: 'video' | 'images'
  video?: string
  images?: string[]
  cover?: string
  music?: string
}

function findMediaFiles(secUid: string, folderName: string, awemeType: number): MediaFiles | null {
  const basePath = join(getDownloadPath(), secUid)
  if (!existsSync(basePath)) return null

  // 查找实际文件夹
  let targetFolder: string | null = null
  const exactPath = join(basePath, folderName)

  if (existsSync(exactPath)) {
    targetFolder = exactPath
  } else {
    // 兼容旧格式
    try {
      const folders = readdirSync(basePath)
      for (const folder of folders) {
        if (folder.endsWith(folderName) || folder.includes(`_${folderName}`)) {
          targetFolder = join(basePath, folder)
          break
        }
      }
    } catch {
      return null
    }
  }

  if (!targetFolder) return null

  try {
    const files = readdirSync(targetFolder)
    const coverFile = files.find((f) => f.includes('_cover.'))
    const cover = coverFile ? toUrlPath(join(targetFolder, coverFile)) : undefined

    // 查找音乐文件
    const musicFile = files.find((f) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f))
    const music = musicFile ? toUrlPath(join(targetFolder, musicFile)) : undefined

    // 图集类型: awemeType === 68
    if (awemeType === 68) {
      const images = files
        .filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f) && !f.includes('_cover'))
        .map((f) => toUrlPath(join(targetFolder!, f)))
        .sort()
      return { type: 'images', images, cover, music }
    }

    // 视频类型（视频自带音轨，不需要额外音乐）
    const videoFile = files.find((f) => /\.(mp4|mov|avi)$/i.test(f))
    const video = videoFile ? toUrlPath(join(targetFolder, videoFile)) : undefined
    return { type: 'video', video, cover }
  } catch {
    return null
  }
}

function findCoverFile(secUid: string, folderName: string): string | null {
  const basePath = join(getDownloadPath(), secUid)
  if (!existsSync(basePath)) return null

  // folderName 现在就是 aweme_id，直接匹配
  const exactPath = join(basePath, folderName)
  if (existsSync(exactPath)) {
    try {
      const files = readdirSync(exactPath)
      const coverFile = files.find((f) => f.includes('_cover.'))
      if (coverFile) return toUrlPath(join(exactPath, coverFile))
    } catch {
      return null
    }
  }

  // 兼容旧格式：扫描目录查找包含 aweme_id 的文件夹
  try {
    const folders = readdirSync(basePath)
    for (const folder of folders) {
      if (folder.endsWith(folderName) || folder.includes(`_${folderName}`)) {
        const folderPath = join(basePath, folder)
        const files = readdirSync(folderPath)
        const coverFile = files.find((f) => f.includes('_cover.'))
        if (coverFile) return toUrlPath(join(folderPath, coverFile))
      }
    }
  } catch {
    return null
  }

  return null
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
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

// 注册自定义协议用于加载本地文件
protocol.registerSchemesAsPrivileged([
  { scheme: 'local', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // 注册 local:// 协议处理器（支持 Range 请求以允许视频进度条拖动）
  protocol.handle('local', async (request) => {
    // 解码并处理 Windows 路径（URL 中可能是正斜杠，需要在 Windows 上转换回反斜杠）
    let filePath = decodeURIComponent(request.url.replace('local://', ''))
    // Windows 路径处理：如果路径以盘符开头（如 /C:/），去掉开头的斜杠
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1)
    }
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
      const fileUrl = process.platform === 'win32'
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

  // 初始化数据库
  initDatabase()

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
  ipcMain.handle('user:add', async (_event, url: string) => {
    console.log('[User:add] Input url:', url)

    // 智能识别链接类型
    const parseResult = await parseDouyinUrl(url)
    console.log('[User:add] Link type:', parseResult.type, 'id:', parseResult.id)

    let userData: Record<string, unknown>
    let homepageUrl = url

    if (parseResult.type === 'user') {
      // 用户链接：直接获取用户资料
      const profileRes = await fetchUserProfileBySecUid(parseResult.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userData = (profileRes as any)._data?.user
    } else if (parseResult.type === 'video') {
      // 作品链接：先获取作品详情，再提取作者信息
      try {
        const postDetail = await fetchVideoDetail(url)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detail = postDetail as any

        console.log('[User:add] PostDetail fields:', {
          secUserId: detail.secUserId,
          nickname: detail.nickname,
          uid: detail.uid
        })

        const secUid = detail.secUserId
        if (!secUid) {
          throw new Error('作品信息中未找到作者数据')
        }

        // 通过 secUserId 获取完整用户资料
        const profileRes = await fetchUserProfileBySecUid(secUid)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        userData = (profileRes as any)._data?.user

        homepageUrl = `https://www.douyin.com/user/${secUid}`
      } catch (error) {
        console.error('[User:add] Failed to fetch video detail:', error)
        throw new Error(
          '获取作品详情失败，请尝试使用用户主页链接（点击作品中的作者头像，复制用户主页链接）'
        )
      }
    } else {
      throw new Error('无法识别的链接类型，请输入用户主页或作品链接')
    }

    if (!userData) {
      throw new Error('获取用户信息失败')
    }

    console.log('[User:add] User data:', {
      sec_uid: userData.sec_uid,
      uid: userData.uid,
      nickname: userData.nickname
    })

    // 检查是否已存在
    const existing = getUserBySecUid(userData.sec_uid as string)
    if (existing) {
      throw new Error('用户已存在')
    }

    // 创建用户
    const input = {
      sec_uid: userData.sec_uid as string,
      uid: (userData.uid as string) || '',
      nickname: (userData.nickname as string) || '',
      signature: (userData.signature as string) || '',
      avatar:
        (userData.avatar_larger as { url_list?: string[] })?.url_list?.[0] ||
        (userData.avatar_medium as { url_list?: string[] })?.url_list?.[0] ||
        '',
      short_id: (userData.short_id as string) || '',
      unique_id: (userData.unique_id as string) || '',
      following_count: (userData.following_count as number) || 0,
      follower_count: (userData.follower_count as number) || 0,
      total_favorited: (userData.total_favorited as number) || 0,
      aweme_count: (userData.aweme_count as number) || 0,
      homepage_url: homepageUrl
    }
    console.log('[User:add] Creating user with:', JSON.stringify(input, null, 2))

    const dbUser = createUser(input)
    console.log('[User:add] User created:', dbUser.id)

    return dbUser
  })
  ipcMain.handle('user:delete', (_event, id: number) => deleteUser(id))
  ipcMain.handle('user:setShowInHome', (_event, id: number, show: boolean) => setUserShowInHome(id, show))
  ipcMain.handle('user:updateSettings', (_event, id: number, input: UpdateUserSettingsInput) =>
    updateUserSettings(id, input)
  )
  ipcMain.handle('user:batchUpdateSettings', (_event, ids: number[], input: Omit<UpdateUserSettingsInput, 'remark'>) =>
    batchUpdateUserSettings(ids, input)
  )
  ipcMain.handle('user:refresh', async (_event, id: number, url: string) => {
    const profileRes = await fetchUserProfile(url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = (profileRes as any)._data?.user
    if (!user) {
      throw new Error('获取用户信息失败')
    }

    const { updateUser } = await import('./database')
    return updateUser(id, {
      nickname: user.nickname,
      signature: user.signature,
      avatar: user.avatar_larger?.url_list?.[0] || user.avatar_medium?.url_list?.[0] || '',
      following_count: user.following_count,
      follower_count: user.follower_count,
      total_favorited: user.total_favorited,
      aweme_count: user.aweme_count
    })
  })
  ipcMain.handle(
    'user:batchRefresh',
    async (_event, users: { id: number; homepage_url: string; nickname: string }[]) => {
      const { updateUser } = await import('./database')
      const results: { success: number; failed: number; details: string[] } = {
        success: 0,
        failed: 0,
        details: []
      }

      for (const u of users) {
        try {
          const profileRes = await fetchUserProfile(u.homepage_url)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const user = (profileRes as any)._data?.user
          if (user) {
            updateUser(u.id, {
              nickname: user.nickname,
              signature: user.signature,
              avatar: user.avatar_larger?.url_list?.[0] || user.avatar_medium?.url_list?.[0] || '',
              following_count: user.following_count,
              follower_count: user.follower_count,
              total_favorited: user.total_favorited,
              aweme_count: user.aweme_count
            })
            results.success++
            results.details.push(`✅ ${u.nickname}`)
          } else {
            results.failed++
            results.details.push(`⚠️ ${u.nickname}: 获取失败，已跳过`)
          }
        } catch (error) {
          results.failed++
          results.details.push(`❌ ${u.nickname}: ${(error as Error).message}`)
        }
        // 延迟避免请求过快
        await new Promise((resolve) => setTimeout(resolve, 300))
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
      input: Partial<{ name: string; status: string; concurrency: number; auto_sync: boolean; sync_cron: string }>
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
  ipcMain.handle('post:getAll', (_event, page?: number, pageSize?: number, filters?: PostFilters) =>
    getAllPosts(page, pageSize, filters)
  )
  ipcMain.handle('post:getAllTags', () => getAllTags())
  ipcMain.handle('post:getCoverPath', (_event, secUid: string, folderName: string) =>
    findCoverFile(secUid, folderName)
  )
  ipcMain.handle('post:getMediaFiles', (_event, secUid: string, folderName: string, awemeType: number) =>
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
  ipcMain.handle('download:start', (_event, taskId: number) => startDownloadTask(taskId))
  ipcMain.handle('download:stop', (_event, taskId: number) => stopDownloadTask(taskId))
  ipcMain.handle('download:isRunning', (_event, taskId: number) => isTaskRunning(taskId))

  // Sync IPC handlers
  ipcMain.handle('sync:start', (_event, userId: number) => startUserSync(userId))
  ipcMain.handle('sync:stop', (_event, userId: number) => stopUserSync(userId))
  ipcMain.handle('sync:isRunning', (_event, userId: number) => isUserSyncing(userId))
  ipcMain.handle('sync:getAnySyncing', () => getAnyUserSyncing())
  ipcMain.handle('sync:validateCron', (_event, expression: string) => validateCronExpression(expression))
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

  // Grok API verification
  ipcMain.handle('grok:verify', async (_event, apiKey: string, apiUrl: string) => {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-2-latest',
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
  ipcMain.handle('analysis:start', (_event, secUid?: string) => startAnalysis(secUid))
  ipcMain.handle('analysis:stop', () => stopAnalysis())
  ipcMain.handle('analysis:isRunning', () => isAnalysisRunning())
  ipcMain.handle('analysis:getUnanalyzedCount', (_event, secUid?: string) =>
    getUnanalyzedPostsCount(secUid)
  )
  ipcMain.handle('analysis:getUnanalyzedCountByUser', () => getUnanalyzedPostsCountByUser())
  ipcMain.handle('analysis:getUserStats', () => getUserAnalysisStats())
  ipcMain.handle('analysis:getTotalStats', () => getTotalAnalysisStats())

  // Video IPC handlers
  ipcMain.handle('video:getDetail', async (_event, url: string) => {
    const detail = await fetchVideoDetail(url) as {
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
      videoUrl: isImages ? undefined : (detail.videoPlayAddr?.[0] || ''),
      imageUrls: isImages ? (detail.images || []) : undefined
    }
  })

  ipcMain.handle('video:downloadToFolder', async (_event, info: {
    awemeId: string
    desc: string
    nickname: string
    type: 'video' | 'images'
    videoUrl?: string
    imageUrls?: string[]
  }) => {
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
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.douyin.com/',
      'Cookie': cookie
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

    shell.openPath(folderPath)
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

  // Migration IPC handler
  ipcMain.handle(
    'migration:execute',
    async (
      _event,
      oldPath: string,
      newPath: string
    ): Promise<{ success: number; failed: number; total: number }> => {
      const posts = getPostsForMigration(oldPath)
      const result = { success: 0, failed: 0, total: posts.length }

      if (posts.length === 0) {
        return result
      }

      // Ensure new path exists
      await mkdir(newPath, { recursive: true })

      for (const post of posts) {
        try {
          // Calculate new paths
          const newVideoPath = post.video_path?.replace(oldPath, newPath) || null
          const newCoverPath = post.cover_path?.replace(oldPath, newPath) || null
          const newMusicPath = post.music_path?.replace(oldPath, newPath) || null

          // Get source folder (use video_path as reference)
          const sourcePath = post.video_path || post.cover_path || post.music_path
          if (!sourcePath) {
            result.failed++
            continue
          }

          const targetPath = sourcePath.replace(oldPath, newPath)
          const sourceDir = sourcePath
          const targetDir = targetPath

          // Move folder if source exists
          if (existsSync(sourceDir)) {
            const targetParent = join(targetDir, '..')
            await mkdir(targetParent, { recursive: true })

            try {
              // Try rename first (fast, same filesystem)
              const { rename } = await import('fs/promises')
              await rename(sourceDir, targetDir)
            } catch {
              // Fall back to copy + delete (cross-filesystem)
              cpSync(sourceDir, targetDir, { recursive: true })
              rmSync(sourceDir, { recursive: true, force: true })
            }
          }

          // Update database
          updatePostPaths(
            post.id,
            newVideoPath || '',
            newCoverPath || '',
            newMusicPath || ''
          )

          result.success++
        } catch (error) {
          console.error(`[Migration] Failed to migrate post ${post.id}:`, error)
          result.failed++
        }
      }

      return result
    }
  )

  // Migration count handler
  ipcMain.handle('migration:getCount', (_event, oldPath: string) => {
    return getPostsForMigration(oldPath).length
  })

  const mainWindow = createWindow()

  // 初始化自动更新（仅在生产环境）
  if (!is.dev) {
    initUpdater(mainWindow)
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createWindow()
      if (!is.dev) {
        initUpdater(win)
      }
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  stopScheduler()
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
