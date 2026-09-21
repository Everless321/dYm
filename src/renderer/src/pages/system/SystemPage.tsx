import { Page, PageBody, Section } from '@/components/layout/Page'
import { PageHeader } from '@/components/layout/PageHeader'
import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import {
  Loader2,
  Chrome,
  Download,
  RefreshCw,
  FolderSync,
  FolderOpen,
  Database,
  X,
  Sparkles,
  RotateCcw
} from 'lucide-react'
import { emitDeveloperModeChange } from '@/lib/developer-mode'

export default function SystemPage() {
  // Cookie
  const [cookie, setCookie] = useState('')
  const [fetchingCookie, setFetchingCookie] = useState(false)
  const [resettingBrowser, setResettingBrowser] = useState(false)

  // 下载
  const [downloadPath, setDownloadPath] = useState('')
  const [maxDownloadCount, setMaxDownloadCount] = useState('0')
  const [videoDownloadConcurrency, setVideoDownloadConcurrency] = useState('3')
  const [convertToJpg, setConvertToJpg] = useState(false)
  const [downloadPostOnAddUser, setDownloadPostOnAddUser] = useState(true)
  const originalDownloadPath = useRef('')

  // 迁移
  const [showMigrationDialog, setShowMigrationDialog] = useState(false)
  const [migrationCount, setMigrationCount] = useState(0)
  const [pendingNewPath, setPendingNewPath] = useState('')
  const [pendingOldPath, setPendingOldPath] = useState('')
  const [migrating, setMigrating] = useState(false)

  // 收藏同步
  const [collectEnabled, setCollectEnabled] = useState(false)
  const [collectBaseUrl, setCollectBaseUrl] = useState('https://dymserver.everless.app')
  const [collectToken, setCollectToken] = useState('')
  const [collectCron, setCollectCron] = useState('*/30 * * * *')
  const [collectSyncing, setCollectSyncing] = useState(false)

  // 直播录制
  const [liveOutputPath, setLiveOutputPath] = useState('')
  const [liveMaxDuration, setLiveMaxDuration] = useState('0')

  // 隐私 / 匿名统计（默认开启）
  const [telemetryEnabled, setTelemetryEnabled] = useState(true)

  // 开发者模式（默认关闭）
  const [developerMode, setDeveloperMode] = useState(false)

  // 允许脚本执行本地命令（默认关闭）
  const [allowShell, setAllowShell] = useState(false)

  // 设置加载完成前禁用保存，避免用默认值覆盖真实配置
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  // 更新
  const [currentVersion, setCurrentVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  useEffect(() => {
    loadSettings()
    loadVersion()

    const unsubscribe = window.api.updater.onStatus((status) => {
      setUpdateStatus(status)
      if (status.status === 'error') {
        toast.error(`更新失败: ${status.error}`)
      } else if (status.status === 'downloaded') {
        toast.success('更新已下载，重启应用即可安装')
      }
    })

    return () => unsubscribe()
  }, [])

  const loadVersion = async () => {
    try {
      const version = await window.api.updater.getCurrentVersion()
      setCurrentVersion(version)
    } catch {
      setCurrentVersion('未知')
    }
  }

  const loadSettings = async () => {
    try {
      const settings = await window.api.settings.getAll()
      setCookie(settings.douyin_cookie || '')
      const savedPath = settings.download_path || ''
      setDownloadPath(savedPath)
      originalDownloadPath.current = savedPath
      setMaxDownloadCount(settings.max_download_count || '0')
      setVideoDownloadConcurrency(settings.video_download_concurrency || '3')
      setConvertToJpg(settings.convert_images_to_jpg === 'true')
      setDownloadPostOnAddUser(settings.download_post_on_add_user !== 'false')
      setCollectEnabled(settings.collect_sync_enabled === 'true')
      setCollectBaseUrl(settings.collect_sync_base_url || 'https://dymserver.everless.app')
      setCollectToken(settings.collect_sync_token || '')
      setCollectCron(settings.collect_sync_cron || '*/30 * * * *')
      setLiveOutputPath(settings.live_output_path || '')
      setLiveMaxDuration(settings.live_max_duration || '0')
      setTelemetryEnabled(settings.telemetry_enabled !== 'false')
      setDeveloperMode(settings.developer_mode === 'true')
      setAllowShell(settings.scripts_allow_shell === 'true')
      setSettingsLoaded(true)
    } catch (error) {
      toast.error(`加载设置失败: ${(error as Error).message}`)
    }
  }

  const handleToggleTelemetry = async () => {
    const next = !telemetryEnabled
    try {
      await window.api.settings.set('telemetry_enabled', next ? 'true' : 'false')
      setTelemetryEnabled(next)
    } catch {
      toast.error('保存失败')
    }
  }

  const handleToggleDeveloperMode = async (): Promise<void> => {
    const next = !developerMode
    try {
      await window.api.settings.set('developer_mode', next ? 'true' : 'false')
      setDeveloperMode(next)
      emitDeveloperModeChange(next)
      toast.success(next ? '开发者模式已开启' : '开发者模式已关闭')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleToggleAllowShell = async (): Promise<void> => {
    const next = !allowShell
    try {
      await window.api.settings.set('scripts_allow_shell', next ? 'true' : 'false')
      setAllowShell(next)
      toast.success(next ? '脚本已可执行本地命令' : '已禁止脚本执行本地命令')
    } catch {
      toast.error('保存失败')
    }
  }

  // Cookie handlers
  const handleFetchCookie = async () => {
    setFetchingCookie(true)
    try {
      const result = await window.api.cookie.fetchDouyin()
      if (result) {
        setCookie(result)
        toast.success('Cookie 获取成功')
      } else {
        // 没登录就关窗：保留输入框里原来的 Cookie，别让接下来的「保存」把它清空
        toast.warning('未检测到登录会话，Cookie 未更新，请在窗口中完成登录')
      }
    } catch {
      toast.error('获取 Cookie 失败')
    } finally {
      setFetchingCookie(false)
    }
  }

  const handleSaveCookie = async () => {
    try {
      await window.api.settings.set('douyin_cookie', cookie)
      toast.success('Cookie 已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleResetBrowser = async (): Promise<void> => {
    if (
      !window.confirm(
        '复位登录浏览器？\n\n会清空登录窗口里的抖音会话、缓存和已保存的 Cookie，之后需要重新扫码登录。\n适用于账号被风控、重新登录也换不掉旧会话的情况。'
      )
    ) {
      return
    }
    setResettingBrowser(true)
    try {
      await window.api.cookie.resetBrowser()
      setCookie('')
      toast.success('已复位，请点击「从浏览器获取」重新登录')
    } catch (error) {
      toast.error(`复位失败：${(error as Error).message}`)
    } finally {
      setResettingBrowser(false)
    }
  }

  // Download handlers
  const handleSaveDownload = async () => {
    try {
      const oldPath =
        originalDownloadPath.current || (await window.api.settings.getDefaultDownloadPath())
      const newPath = downloadPath

      if (newPath && oldPath !== newPath) {
        const count = await window.api.migration.getCount(oldPath)
        if (count > 0) {
          setMigrationCount(count)
          setPendingOldPath(oldPath)
          setPendingNewPath(newPath)
          setShowMigrationDialog(true)
          return
        }
      }

      await saveDownloadSettings()
    } catch {
      toast.error('保存失败')
    }
  }

  const saveDownloadSettings = async () => {
    await window.api.settings.set('download_path', downloadPath)
    await window.api.settings.set('max_download_count', maxDownloadCount)
    await window.api.settings.set('video_download_concurrency', videoDownloadConcurrency)
    await window.api.settings.set('convert_images_to_jpg', convertToJpg ? 'true' : 'false')
    await window.api.settings.set(
      'download_post_on_add_user',
      downloadPostOnAddUser ? 'true' : 'false'
    )
    originalDownloadPath.current = downloadPath
    toast.success('下载设置已保存')
  }

  const handleMigrate = async () => {
    setMigrating(true)
    let result: { success: number; failed: number }
    try {
      result = await window.api.migration.execute(pendingOldPath, pendingNewPath)
    } catch (error) {
      toast.error(`迁移失败: ${(error as Error).message}`)
      setMigrating(false)
      return
    }

    // 文件已经搬走，保存路径失败也要关闭对话框并保留 downloadPath，让用户重试保存
    setShowMigrationDialog(false)
    try {
      await saveDownloadSettings()
      if (result.failed > 0) {
        toast.warning(`迁移完成: 成功 ${result.success} 个，失败 ${result.failed} 个`)
      } else {
        toast.success(`迁移完成: 已迁移 ${result.success} 个文件夹`)
      }
    } catch {
      toast.error('文件已迁移，但保存下载路径失败，请重试保存')
    } finally {
      setMigrating(false)
    }
  }

  const handleSkipMigration = async () => {
    setShowMigrationDialog(false)
    try {
      await saveDownloadSettings()
    } catch {
      toast.error('保存失败')
    }
  }

  // 收藏同步 handlers
  const handleSaveCollect = async () => {
    try {
      await window.api.settings.set('collect_sync_enabled', collectEnabled ? 'true' : 'false')
      await window.api.settings.set('collect_sync_base_url', collectBaseUrl.trim())
      await window.api.settings.set('collect_sync_token', collectToken.trim())
      await window.api.settings.set('collect_sync_cron', collectCron.trim())
      await window.api.collect.reschedule()
      toast.success('收藏同步设置已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  const handleCollectSyncNow = async () => {
    setCollectSyncing(true)
    try {
      await window.api.collect.syncNow()
      toast.success('已触发收藏同步，详情见同步日志')
    } catch (error) {
      toast.error(`触发失败: ${(error as Error).message}`)
    } finally {
      setCollectSyncing(false)
    }
  }

  // 直播录制 handlers
  const handleSaveLive = async () => {
    try {
      await window.api.settings.set('live_output_path', liveOutputPath.trim())
      await window.api.settings.set('live_max_duration', String(parseInt(liveMaxDuration) || 0))
      toast.success('直播录制设置已保存')
    } catch {
      toast.error('保存失败')
    }
  }

  // Update handlers
  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    try {
      const info = await window.api.updater.check()
      if (info) {
        toast.success(`发现新版本: v${info.version}`)
      } else {
        toast.info('当前已是最新版本')
      }
    } catch (error) {
      toast.error(`检查更新失败: ${(error as Error).message}`)
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleDownloadUpdate = async () => {
    try {
      await window.api.updater.download()
      toast.info('开始下载更新...')
    } catch (error) {
      toast.error(`下载失败: ${(error as Error).message}`)
    }
  }

  const handleInstallUpdate = () => {
    window.api.updater.install()
  }

  return (
    <Page>
      <PageHeader title="系统设置" description="下载、分析与更新的全局配置" />

      <PageBody className="space-y-8">
        <Section eyebrow="基础配置" title="账号与接口">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Cookie Card */}
            <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-[#1D1D1F]">抖音 Cookie</h2>
                  <p className="text-xs text-[#A1A1A6]">设置抖音登录 Cookie 用于获取视频数据</p>
                </div>
                <button
                  onClick={handleFetchCookie}
                  disabled={fetchingCookie}
                  className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 w-full sm:w-auto"
                >
                  {fetchingCookie ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Chrome className="h-4 w-4" />
                  )}
                  从浏览器获取
                </button>
              </div>

              <div className="space-y-3 mt-4">
                <textarea
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder="粘贴 Cookie 或点击上方按钮自动获取..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono resize-none transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                />
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={handleResetBrowser}
                    disabled={resettingBrowser || fetchingCookie}
                    title="清空登录窗口的会话与缓存，下次登录换一个全新的会话"
                    className="h-9 px-3 rounded-lg text-sm text-[#86868B] hover:text-[#FF3B30] hover:bg-[#FF3B30]/5 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {resettingBrowser ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    浏览器复位
                  </button>
                  <button
                    onClick={handleSaveCookie}
                    disabled={!settingsLoaded}
                    className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors disabled:opacity-50"
                  >
                    保存 Cookie
                  </button>
                </div>
              </div>
            </div>

            {/* AI 服务入口（配置已迁到「视频分析」页） */}
            <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
              <h2 className="text-base font-semibold text-[#1D1D1F] mb-2">AI 服务</h2>
              <p className="text-xs text-[#A1A1A6] mb-4">
                AI 提供方（Grok / OpenAI / Claude / Gemini / OpenCode / ChatGPT
                订阅等）、分析指令与队列参数已统一到「视频分析」页管理
              </p>
              <div className="flex justify-end">
                <Link
                  to="/analysis?tab=providers"
                  className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  前往配置 AI 提供方
                </Link>
              </div>
            </div>
          </div>
        </Section>

        <Section eyebrow="任务参数" title="下载与分析">
          <div className="grid gap-6">
            {/* Download Settings Card */}
            <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
              <h2 className="text-base font-semibold text-[#1D1D1F] mb-4">下载设置</h2>

              <div className="divide-y divide-[#E5E5E7]">
                {/* Download Path */}
                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">下载路径</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">视频下载保存位置</p>
                  </div>
                  <div className="flex items-center gap-2 w-full md:w-[320px]">
                    <input
                      type="text"
                      value={downloadPath}
                      onChange={(e) => setDownloadPath(e.target.value)}
                      placeholder="/Users/downloads/douyin"
                      className="flex-1 h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const path = await window.api.system.openDirectoryDialog()
                        if (path) setDownloadPath(path)
                      }}
                      className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-[#E5E5E7] bg-[#F5F5F7] hover:bg-[#E8E8ED] transition-colors"
                      title="选择目录"
                    >
                      <FolderOpen className="h-4 w-4 text-[#6E6E73]" />
                    </button>
                  </div>
                </div>

                {/* Max Download Count */}
                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">最大下载数量</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">0 表示无限制</p>
                  </div>
                  <input
                    type="number"
                    value={maxDownloadCount}
                    onChange={(e) => setMaxDownloadCount(e.target.value)}
                    className="w-full md:w-[140px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20 text-center"
                  />
                </div>

                {/* Concurrency */}
                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">并发下载数</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">同时下载的视频数量</p>
                  </div>
                  <input
                    type="number"
                    value={videoDownloadConcurrency}
                    onChange={(e) => setVideoDownloadConcurrency(e.target.value)}
                    min="1"
                    className="w-20 h-9 px-3 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono text-center focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>
                {/* Convert Images to JPG */}
                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">图片转 JPG</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">下载图文作品时自动转换为 JPG 格式</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConvertToJpg(!convertToJpg)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      convertToJpg ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        convertToJpg ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                {/* Download post on add-user via video link */}
                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">添加用户时下载作品</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">
                      输入作品链接添加用户时，后台下载该作品；用户已存在则补下载
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDownloadPostOnAddUser(!downloadPostOnAddUser)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      downloadPostOnAddUser ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        downloadPostOnAddUser ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveDownload}
                  disabled={!settingsLoaded}
                  className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors disabled:opacity-50"
                >
                  保存下载设置
                </button>
              </div>
            </div>
          </div>
        </Section>

        <Section eyebrow="自动化" title="收藏同步">
          <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
            <p className="text-xs text-[#A1A1A6] mb-4">
              Surge
              拦截抖音收藏请求并上报到暂存服务，应用按计划拉取收藏的作品并自动添加作者（按上方「添加用户时下载作品」开关决定是否下载收藏的作品）。
            </p>

            <div className="divide-y divide-[#E5E5E7]">
              {/* Enable */}
              <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm text-[#1D1D1F]">启用收藏同步</p>
                  <p className="text-xs text-[#A1A1A6] mt-1">按计划自动拉取并添加</p>
                </div>
                <button
                  type="button"
                  onClick={() => setCollectEnabled(!collectEnabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                    collectEnabled ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      collectEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Base URL */}
              <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="md:min-w-[120px]">
                  <p className="text-sm text-[#1D1D1F]">服务器地址</p>
                  <p className="text-xs text-[#A1A1A6] mt-1">暂存服务的基础 URL</p>
                </div>
                <input
                  type="text"
                  value={collectBaseUrl}
                  onChange={(e) => setCollectBaseUrl(e.target.value)}
                  placeholder="https://dymserver.everless.app"
                  className="w-full md:w-[360px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                />
              </div>

              {/* Token */}
              <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="md:min-w-[120px]">
                  <p className="text-sm text-[#1D1D1F]">Token</p>
                  <p className="text-xs text-[#A1A1A6] mt-1">与 Surge 模块一致的身份令牌</p>
                </div>
                <input
                  type="password"
                  value={collectToken}
                  onChange={(e) => setCollectToken(e.target.value)}
                  placeholder="收藏服务 token"
                  className="w-full md:w-[360px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                />
              </div>

              {/* Cron */}
              <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="md:min-w-[120px]">
                  <p className="text-sm text-[#1D1D1F]">拉取计划</p>
                  <p className="text-xs text-[#A1A1A6] mt-1">Cron 表达式</p>
                </div>
                <div className="flex flex-col gap-2 w-full md:w-[360px]">
                  <input
                    type="text"
                    value={collectCron}
                    onChange={(e) => setCollectCron(e.target.value)}
                    placeholder="*/30 * * * *"
                    className="h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                  />
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: '15 分钟', cron: '*/15 * * * *' },
                      { label: '30 分钟', cron: '*/30 * * * *' },
                      { label: '1 小时', cron: '0 * * * *' },
                      { label: '3 小时', cron: '0 */3 * * *' }
                    ].map((preset) => (
                      <button
                        key={preset.cron}
                        type="button"
                        onClick={() => setCollectCron(preset.cron)}
                        className={`h-7 px-3 rounded-md border text-xs transition-colors ${
                          collectCron === preset.cron
                            ? 'border-[#0A84FF] text-[#0A84FF] bg-[#E8F0FE]'
                            : 'border-[#E5E5E7] text-[#6E6E73] hover:bg-[#F2F2F4]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={handleCollectSyncNow}
                disabled={collectSyncing}
                className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {collectSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                立即同步
              </button>
              <button
                onClick={handleSaveCollect}
                disabled={!settingsLoaded}
                className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors disabled:opacity-50"
              >
                保存收藏同步设置
              </button>
            </div>
          </div>
        </Section>

        <Section eyebrow="自动化" title="直播录制">
          <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
            <p className="text-xs text-[#A1A1A6] mb-4">
              在「用户管理」中为用户开启「录制直播」并设置检测计划，应用会按计划检测开播并用 ffmpeg
              自动录制。录制文件默认保存到下方目录（按 sec_uid 分文件夹）。
            </p>

            <div className="divide-y divide-[#E5E5E7]">
              {/* Output path */}
              <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="md:min-w-[120px]">
                  <p className="text-sm text-[#1D1D1F]">录制目录</p>
                  <p className="text-xs text-[#A1A1A6] mt-1">留空则用默认下载目录下的 live</p>
                </div>
                <div className="flex gap-2 w-full md:w-[360px]">
                  <input
                    type="text"
                    value={liveOutputPath}
                    onChange={(e) => setLiveOutputPath(e.target.value)}
                    placeholder="默认：<用户数据>/Download/live"
                    className="flex-1 h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const path = await window.api.system.openDirectoryDialog()
                      if (path) setLiveOutputPath(path)
                    }}
                    className="h-10 px-3 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex-shrink-0"
                  >
                    选择
                  </button>
                </div>
              </div>

              {/* Max duration */}
              <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="md:min-w-[120px]">
                  <p className="text-sm text-[#1D1D1F]">最大时长（分钟）</p>
                  <p className="text-xs text-[#A1A1A6] mt-1">0 表示不限，录到直播结束</p>
                </div>
                <input
                  type="number"
                  min="0"
                  value={liveMaxDuration}
                  onChange={(e) => setLiveMaxDuration(e.target.value)}
                  placeholder="0"
                  className="w-full md:w-[360px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSaveLive}
                disabled={!settingsLoaded}
                className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors disabled:opacity-50"
              >
                保存直播录制设置
              </button>
            </div>
          </div>
        </Section>

        <Section eyebrow="系统" title="版本与安全">
          <div className="grid gap-6">
            {/* Version & Update Card */}
            <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
              <h2 className="text-base font-semibold text-[#1D1D1F] mb-4">关于</h2>

              <div className="divide-y divide-[#E5E5E7]">
                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">当前版本</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">v{currentVersion}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {updateStatus?.status === 'available' && (
                      <button
                        onClick={handleDownloadUpdate}
                        className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors flex items-center gap-2"
                      >
                        <Download className="h-4 w-4" />
                        下载 v{updateStatus.info?.version}
                      </button>
                    )}
                    {updateStatus?.status === 'downloading' && (
                      <div className="flex items-center gap-2 text-sm text-[#A1A1A6]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        下载中 {Math.round(updateStatus.progress || 0)}%
                      </div>
                    )}
                    {updateStatus?.status === 'downloaded' && (
                      <button
                        onClick={handleInstallUpdate}
                        className="h-9 px-4 rounded-lg bg-[#22C55E] text-sm text-white font-medium hover:bg-[#16A34A] transition-colors flex items-center gap-2"
                      >
                        <RefreshCw className="h-4 w-4" />
                        重启安装
                      </button>
                    )}
                    {(!updateStatus ||
                      updateStatus.status === 'not-available' ||
                      updateStatus.status === 'error') && (
                      <button
                        onClick={handleCheckUpdate}
                        disabled={checkingUpdate}
                        className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-2 disabled:opacity-50"
                      >
                        {checkingUpdate ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        检查更新
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">GitHub</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">查看源代码和发布记录</p>
                  </div>
                  <a
                    href="https://github.com/Everless321/dYm"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#0A84FF] hover:underline"
                  >
                    Everless321/dYm
                  </a>
                </div>

                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">数据目录</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">数据库及配置文件所在位置</p>
                  </div>
                  <button
                    onClick={() => window.api.system.openDataDirectory()}
                    className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-2"
                  >
                    <Database className="h-4 w-4" />
                    打开目录
                  </button>
                </div>

                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">匿名使用统计</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">
                      仅上报启动次数、应用版本、操作系统等匿名数据，帮助改进产品；不含任何个人信息或下载内容，可随时关闭
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleTelemetry}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      telemetryEnabled ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        telemetryEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">开发者模式</p>
                    <p className="text-xs text-[#A1A1A6] mt-1">
                      开启后侧边栏显示「自定义脚本」模块，用于编写脚本扩展应用能力
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleDeveloperMode}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                      developerMode ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        developerMode ? 'translate-x-[22px]' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {/* 只在开发者模式下露出——没有脚本功能时这个开关没有意义 */}
                {developerMode && (
                  <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm text-[#1D1D1F]">允许脚本执行本地命令</p>
                      <p className="text-xs text-[#A1A1A6] mt-1">
                        开启后脚本可通过 api.shell 调用 python、ffmpeg 等本地程序
                      </p>
                      <p className="text-xs text-[#FF9500] mt-1">
                        脚本将能在这台电脑上执行任意命令，只在运行你信任的脚本时开启
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleToggleAllowShell}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                        allowShell ? 'bg-[#FF9500]' : 'bg-[#D1D1D6]'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          allowShell ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Section>
      </PageBody>

      {/* Migration Dialog */}
      {showMigrationDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl w-[480px] shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E7]">
              <div className="flex items-center gap-3">
                <FolderSync className="h-5 w-5 text-[#0A84FF]" />
                <h3 className="text-base font-semibold text-[#1D1D1F]">检测到下载路径变更</h3>
              </div>
              <button
                onClick={() => setShowMigrationDialog(false)}
                className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-[#F2F2F4] transition-colors"
              >
                <X className="h-4 w-4 text-[#6E6E73]" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5">
              <p className="text-sm text-[#1D1D1F] mb-4">
                发现 <span className="font-medium text-[#0A84FF]">{migrationCount}</span>{' '}
                个视频文件夹在旧路径中。
              </p>
              <p className="text-sm text-[#6E6E73] mb-4">
                是否将文件迁移到新路径？迁移后数据库记录将自动更新。
              </p>
              <div className="text-xs text-[#A1A1A6] space-y-1 bg-[#F2F2F4] rounded-lg p-3">
                <p>
                  <span className="text-[#6E6E73]">旧路径:</span>{' '}
                  {originalDownloadPath.current || '默认路径'}
                </p>
                <p>
                  <span className="text-[#6E6E73]">新路径:</span> {pendingNewPath}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#E5E5E7]">
              <button
                onClick={handleSkipMigration}
                disabled={migrating}
                className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors disabled:opacity-50"
              >
                跳过迁移
              </button>
              <button
                onClick={handleMigrate}
                disabled={migrating}
                className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {migrating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    迁移中...
                  </>
                ) : (
                  <>
                    <FolderSync className="h-4 w-4" />
                    迁移文件
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}
