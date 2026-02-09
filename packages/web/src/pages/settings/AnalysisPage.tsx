import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { Sparkles, ChevronDown, Square, Play, Search } from 'lucide-react'
import { MediaViewer } from '@/components/MediaViewer'
import { analysisApi, settingsApi, postsApi } from '@/api/client'
import { useWsChannel } from '@/hooks/useWebSocket'
import type {
  DbPost,
  UserAnalysisStats,
  TotalAnalysisStats,
  AnalysisProgress
} from '@dym/shared'

interface SystemResourceInfo {
  cpuUsage: number
  memoryUsage: number
  memoryUsed: number
  memoryTotal: number
}

export default function AnalysisPage() {
  const [userStats, setUserStats] = useState<UserAnalysisStats[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string>('all')
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [userSearch, setUserSearch] = useState('')

  const [prompt, setPrompt] = useState('')
  const [concurrency, setConcurrency] = useState('3')
  const [slices, setSlices] = useState('4')
  const [rpm, setRpm] = useState('20')

  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [totalStats, setTotalStats] = useState<TotalAnalysisStats>({
    total: 0,
    analyzed: 0,
    unanalyzed: 0
  })
  const [systemResource, setSystemResource] = useState<SystemResourceInfo | null>(null)

  const [allAnalyzedPosts, setAllAnalyzedPosts] = useState<DbPost[]>([])

  const [selectedPost, setSelectedPost] = useState<DbPost | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)

  useEffect(() => {
    loadData()
    loadSettings()
    checkRunningStatus()
  }, [])

  useWsChannel('analysis:progress', (p) => {
    setProgress(p)
    if (p.status === 'completed' || p.status === 'failed' || p.status === 'stopped') {
      setIsRunning(false)
      loadData()
    }
  })

  useEffect(() => {
    if (!isRunning) {
      setSystemResource(null)
      return
    }

    const pollResource = async () => {
      try {
        const res = await fetch('/api/system/resources')
        const json = await res.json()
        if (json.success) setSystemResource(json.data)
      } catch {
        // ignore
      }
    }

    pollResource()
    const interval = setInterval(pollResource, 2000)
    return () => clearInterval(interval)
  }, [isRunning])

  const loadData = async () => {
    const [userStatsList, stats, postsData] = await Promise.all([
      analysisApi.getUserStats(),
      analysisApi.getTotalStats(),
      postsApi.getAll(1, 100, { analyzedOnly: true })
    ])
    setUserStats(userStatsList)
    setTotalStats(stats)
    setAllAnalyzedPosts(postsData.posts)
  }

  const loadSettings = async () => {
    const settings = await settingsApi.getAll()
    setPrompt(settings.analysis_prompt || '')
    setConcurrency(settings.analysis_concurrency || '3')
    setSlices(settings.analysis_slices || '4')
    setRpm(settings.analysis_rpm || '20')
  }

  const checkRunningStatus = async () => {
    const running = await analysisApi.isRunning()
    setIsRunning(running)
  }

  const handleStart = async () => {
    await Promise.all([
      settingsApi.set('analysis_prompt', prompt),
      settingsApi.set('analysis_concurrency', concurrency),
      settingsApi.set('analysis_slices', slices),
      settingsApi.set('analysis_rpm', rpm)
    ])

    try {
      setIsRunning(true)
      setProgress(null)
      const secUid = selectedUserId === 'all' ? undefined : selectedUserId
      await analysisApi.start(secUid)
    } catch (error) {
      toast.error((error as Error).message)
      setIsRunning(false)
    }
  }

  const handleStop = async () => {
    try {
      await analysisApi.stop()
      toast.info('正在停止分析...')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const handleVideoClick = (post: DbPost) => {
    setSelectedPost(post)
    setViewerOpen(true)
  }

  const selectedUser = userStats.find((u) => u.sec_uid === selectedUserId)

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return userStats
    const search = userSearch.toLowerCase()
    return userStats.filter((u) => u.nickname.toLowerCase().includes(search))
  }, [userStats, userSearch])

  const tagColors = [
    { bg: '#0A84FF20', text: '#0A84FF' },
    { bg: '#5AC8FA20', text: '#5AC8FA' },
    { bg: '#22C55E20', text: '#22C55E' },
    { bg: '#F59E0B20', text: '#F59E0B' },
    { bg: '#8B5CF620', text: '#8B5CF6' },
    { bg: '#EC489920', text: '#EC4899' },
    { bg: '#06B6D420', text: '#06B6D4' },
    { bg: '#EF444420', text: '#EF4444' }
  ]

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const post of allAnalyzedPosts) {
      if (post.analysis_tags) {
        try {
          const tags = JSON.parse(post.analysis_tags) as string[]
          tags.forEach((tag) => {
            counts[tag] = (counts[tag] || 0) + 1
          })
        } catch {
          // ignore
        }
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
  }, [allAnalyzedPosts])

  const recentPosts = allAnalyzedPosts.slice(0, 10)

  const progressPercent = progress?.totalPosts
    ? Math.round(((progress.analyzedCount + progress.failedCount) / progress.totalPosts) * 100)
    : 0

  return (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center justify-between px-6 border-b border-[#E5E5E7] bg-white flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-[#1D1D1F]">AI 视频分析</h1>
          <p className="text-sm text-[#6E6E73] mt-0.5">批量分析与标签生成，统一管理分析策略</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs text-[#6E6E73]">
            <span className="px-2.5 py-1 rounded-full bg-[#F2F2F4]">
              待分析 {totalStats.unanalyzed}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-[#F2F2F4]">
              已分析 {totalStats.analyzed}
            </span>
          </div>
          {isRunning ? (
            <button
              onClick={handleStop}
              className="h-9 px-4 rounded-lg bg-[#0A84FF] text-white text-sm font-medium flex items-center gap-2 hover:bg-[#0060D5] transition-colors"
            >
              <Square className="h-4 w-4" />
              停止分析
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={totalStats.unanalyzed === 0}
              className="h-9 px-4 rounded-lg bg-[#0A84FF] text-white text-sm font-medium flex items-center gap-2 hover:bg-[#0060D5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="h-4 w-4" />
              开始分析
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-6 py-8">
        <div className="mx-auto max-w-6xl w-full h-full">
          <div className="flex gap-6 h-full">
            {/* Left Panel */}
            <div className="w-96 flex-shrink-0 space-y-6 overflow-y-auto pr-1">
              {/* Select User Card */}
              <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
                <h3 className="text-[15px] font-semibold text-[#1D1D1F]">选择用户</h3>
                <p className="text-[13px] text-[#A1A1A6] mt-1 mb-4">选择要分析的用户视频</p>

                <div className="relative">
                  <button
                    onClick={() => {
                      setShowUserDropdown(!showUserDropdown)
                      if (!showUserDropdown) setUserSearch('')
                    }}
                    className="w-full h-11 px-4 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] flex items-center justify-between text-sm"
                  >
                    <span className="text-[#1D1D1F]">
                      {selectedUserId === 'all' ? '全部用户' : selectedUser?.nickname || '选择用户'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[#A1A1A6]">
                        {selectedUserId === 'all'
                          ? `${totalStats.analyzed}/${totalStats.total}`
                          : selectedUser
                            ? `${selectedUser.analyzed}/${selectedUser.total}`
                            : ''}
                      </span>
                      <ChevronDown className="h-4 w-4 text-[#A1A1A6]" />
                    </div>
                  </button>
                  {showUserDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg border border-[#E5E5E7] shadow-md z-10 max-h-72 flex flex-col">
                      <div className="p-2 border-b border-[#E5E5E7]">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#A1A1A6]" />
                          <input
                            type="text"
                            value={userSearch}
                            onChange={(e) => setUserSearch(e.target.value)}
                            placeholder="搜索用户..."
                            className="w-full h-8 pl-8 pr-3 rounded-md bg-[#F2F2F4] text-sm text-[#1D1D1F] placeholder:text-[#A1A1A6] focus:outline-none focus:ring-1 focus:ring-[#0A84FF]"
                            autoFocus
                          />
                        </div>
                      </div>
                      <div className="overflow-y-auto flex-1">
                        {!userSearch && (
                          <button
                            onClick={() => {
                              setSelectedUserId('all')
                              setShowUserDropdown(false)
                              setUserSearch('')
                            }}
                            className={`w-full px-4 py-2.5 text-left hover:bg-[#F2F2F4] transition-colors flex items-center justify-between ${
                              selectedUserId === 'all'
                                ? 'text-[#0A84FF] font-medium'
                                : 'text-[#1D1D1F]'
                            }`}
                          >
                            <span className="text-sm">全部用户</span>
                            <span className="text-xs text-[#A1A1A6]">
                              {totalStats.analyzed}/{totalStats.total}
                            </span>
                          </button>
                        )}
                        {filteredUsers.length > 0 ? (
                          filteredUsers.map((user) => (
                            <button
                              key={user.sec_uid}
                              onClick={() => {
                                setSelectedUserId(user.sec_uid)
                                setShowUserDropdown(false)
                                setUserSearch('')
                              }}
                              className={`w-full px-4 py-2.5 text-left hover:bg-[#F2F2F4] transition-colors flex items-center justify-between ${
                                selectedUserId === user.sec_uid
                                  ? 'text-[#0A84FF] font-medium'
                                  : 'text-[#1D1D1F]'
                              }`}
                            >
                              <span className="text-sm">{user.nickname}</span>
                              <span
                                className={`text-xs ${user.unanalyzed > 0 ? 'text-[#0A84FF]' : 'text-[#A1A1A6]'}`}
                              >
                                {user.analyzed}/{user.total}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-[#A1A1A6] text-center">
                            未找到匹配用户
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Prompt Config Card */}
              <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
                <h3 className="text-[15px] font-semibold text-[#1D1D1F]">分析提示词</h3>
                <p className="text-xs text-[#A1A1A6] mt-1 mb-4">
                  AI将根据提示词分析视频内容并生成标签
                </p>

                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={`请分析这个视频的内容，包括：\n1. 视频主题和类型\n2. 主要内容描述\n3. 情感倾向（正面/负面/中性）\n4. 生成3-5个相关标签`}
                  rows={5}
                  className="w-full px-3 py-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-[13px] text-[#6E6E73] leading-relaxed resize-none focus:outline-none focus:border-[#0A84FF]"
                />
              </div>

              {/* Analysis Params Card */}
              <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
                <h3 className="text-[15px] font-semibold text-[#1D1D1F] mb-4">分析参数</h3>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">分析并发数</p>
                    <p className="text-[11px] text-[#A1A1A6] mt-0.5">同时分析的视频数量</p>
                  </div>
                  <input
                    type="number"
                    value={concurrency}
                    onChange={(e) => setConcurrency(e.target.value)}
                    min="1"
                    max="10"
                    className="w-20 h-9 px-3 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono text-center focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">截图数量</p>
                    <p className="text-[11px] text-[#A1A1A6] mt-0.5">每个视频截取的图片数</p>
                  </div>
                  <input
                    type="number"
                    value={slices}
                    onChange={(e) => setSlices(e.target.value)}
                    min="1"
                    max="10"
                    className="w-20 h-9 px-3 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono text-center focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>

                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm text-[#1D1D1F]">每分钟请求数</p>
                    <p className="text-[11px] text-[#A1A1A6] mt-0.5">API请求频率限制</p>
                  </div>
                  <input
                    type="number"
                    value={rpm}
                    onChange={(e) => setRpm(e.target.value)}
                    min="1"
                    max="60"
                    className="w-20 h-9 px-3 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono text-center focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>
              </div>
            </div>

            {/* Right Panel */}
            <div className="flex-1 min-w-0 min-h-0">
              <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm h-full flex flex-col overflow-hidden">
                <div className="h-14 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between px-5 border-b border-[#E5E5E7] flex-shrink-0">
                  <h3 className="text-[15px] font-semibold text-[#1D1D1F]">分析结果</h3>
                  <span className="text-[13px] text-[#A1A1A6]">
                    已分析 {totalStats.analyzed}/{totalStats.total} 个视频
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {isRunning && progress && (
                    <div className="bg-[#E8F0FE] rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-[#0A84FF]">正在分析...</span>
                        <span className="text-sm font-mono text-[#0A84FF]">
                          {progress.analyzedCount + progress.failedCount}/{progress.totalPosts}
                        </span>
                      </div>
                      <div className="h-2 bg-white rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0A84FF] transition-all duration-300"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between mt-3 text-xs">
                        <div className="flex gap-3">
                          <span className="text-[#22C55E]">✓ 成功 {progress.analyzedCount}</span>
                          <span className="text-[#EF4444]">✗ 失败 {progress.failedCount}</span>
                        </div>
                        <span className="text-[#6E6E73]">{progressPercent}%</span>
                      </div>

                      {systemResource && (
                        <div className="flex gap-4 mt-3 pt-3 border-t border-[#0A84FF]/20">
                          <div className="flex-1">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-[#6E6E73]">CPU</span>
                              <span className="font-mono text-[#1D1D1F]">
                                {systemResource.cpuUsage}%
                              </span>
                            </div>
                            <div className="h-1.5 bg-white rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${
                                  systemResource.cpuUsage > 80
                                    ? 'bg-[#EF4444]'
                                    : systemResource.cpuUsage > 50
                                      ? 'bg-[#F59E0B]'
                                      : 'bg-[#22C55E]'
                                }`}
                                style={{ width: `${systemResource.cpuUsage}%` }}
                              />
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-[#6E6E73]">内存</span>
                              <span className="font-mono text-[#1D1D1F]">
                                {systemResource.memoryUsed}G/{systemResource.memoryTotal}G
                              </span>
                            </div>
                            <div className="h-1.5 bg-white rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${
                                  systemResource.memoryUsage > 80
                                    ? 'bg-[#EF4444]'
                                    : systemResource.memoryUsage > 50
                                      ? 'bg-[#F59E0B]'
                                      : 'bg-[#22C55E]'
                                }`}
                                style={{ width: `${systemResource.memoryUsage}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {progress.message && (
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#0A84FF]/20">
                          <Play className="h-3 w-3 text-[#6E6E73] flex-shrink-0" />
                          <p className="text-xs text-[#6E6E73] truncate">{progress.message}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tag Section */}
                  <div>
                    <h4 className="text-sm font-semibold text-[#1D1D1F] mb-3">热门标签</h4>
                    {tagCounts.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {tagCounts.map(([tag, count], idx) => {
                          const color = tagColors[idx % tagColors.length]
                          return (
                            <span
                              key={tag}
                              className="h-8 px-3.5 rounded-full text-[13px] flex items-center"
                              style={{ backgroundColor: color.bg, color: color.text }}
                            >
                              {tag} ({count})
                            </span>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-[#A1A1A6]">暂无标签数据</p>
                    )}
                  </div>

                  {/* Recent Videos Section */}
                  <div>
                    <h4 className="text-sm font-semibold text-[#1D1D1F] mb-3">最近分析的视频</h4>
                    {recentPosts.length > 0 ? (
                      <div className="space-y-3">
                        {recentPosts.map((post, idx) => {
                          const postTags = post.analysis_tags
                            ? (JSON.parse(post.analysis_tags) as string[])
                            : []
                          const coverUrl = post.folder_name
                            ? postsApi.getCoverUrl(post.sec_uid, post.folder_name)
                            : null
                          return (
                            <button
                              key={post.id}
                              onClick={() => handleVideoClick(post)}
                              className="w-full flex items-center gap-3 p-3 rounded-lg bg-[#F5F5F7] hover:bg-[#F2F2F4] transition-colors text-left"
                            >
                              <div className="w-20 h-[60px] rounded-md bg-[#F2F2F4] overflow-hidden flex-shrink-0">
                                {coverUrl ? (
                                  <img
                                    src={coverUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Play className="h-5 w-5 text-[#A1A1A6]" />
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium text-[#1D1D1F] line-clamp-1">
                                  {post.desc || post.caption || '无标题'}
                                </p>
                                {postTags.length > 0 && (
                                  <div className="flex gap-1.5 mt-1.5">
                                    {postTags.slice(0, 2).map((tag, tagIdx) => {
                                      const color = tagColors[(idx + tagIdx) % tagColors.length]
                                      return (
                                        <span
                                          key={tag}
                                          className="h-5 px-2 rounded text-xs flex items-center"
                                          style={{ backgroundColor: color.bg, color: color.text }}
                                        >
                                          {tag}
                                        </span>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="py-8 text-center">
                        <Sparkles className="h-10 w-10 text-[#E5E5E7] mx-auto mb-3" />
                        <p className="text-sm text-[#A1A1A6]">暂无分析数据</p>
                        <p className="text-xs text-[#A1A1A6] mt-1">开始分析后将在这里显示结果</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MediaViewer
        post={selectedPost}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        allPosts={allAnalyzedPosts}
        onSelectPost={setSelectedPost}
      />
    </div>
  )
}
