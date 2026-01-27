import { app, shell, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
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
  type CreateTaskInput,
  type UpdateUserSettingsInput,
  type PostFilters
} from './database'
import { fetchDouyinCookie } from './services/cookie'
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
import {
  getUnanalyzedPostsCount,
  getUnanalyzedPostsCountByUser,
  getUserAnalysisStats,
  getTotalAnalysisStats
} from './database'

function getDownloadPath(): string {
  return join(app.getPath('userData'), 'Download', 'post')
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
    const cover = coverFile ? join(targetFolder, coverFile) : undefined

    // 查找音乐文件
    const musicFile = files.find((f) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f))
    const music = musicFile ? join(targetFolder, musicFile) : undefined

    // 图集类型: awemeType === 68
    if (awemeType === 68) {
      const images = files
        .filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f) && !f.includes('_cover'))
        .map((f) => join(targetFolder!, f))
        .sort()
      return { type: 'images', images, cover, music }
    }

    // 视频类型（视频自带音轨，不需要额外音乐）
    const videoFile = files.find((f) => /\.(mp4|mov|avi)$/i.test(f))
    const video = videoFile ? join(targetFolder, videoFile) : undefined
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
      if (coverFile) return join(exactPath, coverFile)
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
        if (coverFile) return join(folderPath, coverFile)
      }
    }
  } catch {
    return null
  }

  return null
}

function createWindow(): void {
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
}

// 注册自定义协议用于加载本地文件
protocol.registerSchemesAsPrivileged([
  { scheme: 'local', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // 注册 local:// 协议处理器
  protocol.handle('local', (request) => {
    const filePath = decodeURIComponent(request.url.replace('local://', ''))
    return net.fetch(`file://${filePath}`)
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
    (_event, id: number, input: Partial<{ name: string; status: string; concurrency: number }>) =>
      updateTask(id, input as Parameters<typeof updateTask>[1])
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

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  closeDatabase()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
