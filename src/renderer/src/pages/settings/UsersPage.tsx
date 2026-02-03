import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  User,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Settings2,
  Download,
  X,
  Play,
  Square,
  Clock,
  ExternalLink,
  Search,
  SlidersHorizontal
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

type SortOption = 'default' | 'undownloaded' | 'total'
type ShowInHomeFilter = 'all' | 'yes' | 'no'
type AutoSyncFilter = 'all' | 'yes' | 'no'
type DownloadStatusFilter = 'all' | 'completed' | 'partial' | 'none'

export default function UsersPage() {
  const [users, setUsers] = useState<DbUser[]>([])
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [batchRefreshing, setBatchRefreshing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState<SortOption>('default')
  const [showInHomeFilter, setShowInHomeFilter] = useState<ShowInHomeFilter>('all')
  const [autoSyncFilter, setAutoSyncFilter] = useState<AutoSyncFilter>('all')
  const [downloadStatusFilter, setDownloadStatusFilter] = useState<DownloadStatusFilter>('all')
  const [, setClipboardStatus] = useState<{
    detected: boolean
    type: 'user' | 'video' | 'unknown' | null
    url: string
  }>({ detected: false, type: null, url: '' })

  const [editingUser, setEditingUser] = useState<DbUser | null>(null)
  const [editForm, setEditForm] = useState({
    remark: '',
    max_download_count: 0,
    show_in_home: true,
    auto_sync: false,
    sync_cron: ''
  })
  const [editLoading, setEditLoading] = useState(false)
  const [cronValid, setCronValid] = useState(true)

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchEditOpen, setBatchEditOpen] = useState(false)
  const [batchForm, setBatchForm] = useState({
    max_download_count: 0,
    show_in_home: true
  })
  const [batchLoading, setBatchLoading] = useState(false)

  const [syncingUserId, setSyncingUserId] = useState<number | null>(null)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)

  useEffect(() => {
    loadUsers()
    // 检查是否有用户正在同步
    window.api.sync.getAnySyncing().then(setSyncingUserId)
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.sync.onProgress((progress) => {
      setSyncProgress(progress)
      if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'stopped') {
        setSyncingUserId(null)
        loadUsers()
      }
    })
    return unsubscribe
  }, [])

  const filteredUsers = useMemo(() => {
    let result = users

    // 文本搜索
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      result = result.filter(
        (u) =>
          u.nickname?.toLowerCase().includes(term) ||
          u.unique_id?.toLowerCase().includes(term) ||
          u.short_id?.toLowerCase().includes(term)
      )
    }

    // 首页显示筛选
    if (showInHomeFilter !== 'all') {
      result = result.filter((u) =>
        showInHomeFilter === 'yes' ? !!u.show_in_home : !u.show_in_home
      )
    }

    // 自动同步筛选
    if (autoSyncFilter !== 'all') {
      result = result.filter((u) =>
        autoSyncFilter === 'yes' ? !!u.auto_sync : !u.auto_sync
      )
    }

    // 下载状态筛选
    if (downloadStatusFilter !== 'all') {
      result = result.filter((u) => {
        const downloaded = u.downloaded_count
        const total = u.aweme_count
        if (downloadStatusFilter === 'completed') {
          return total > 0 && downloaded >= total
        } else if (downloadStatusFilter === 'partial') {
          return downloaded > 0 && downloaded < total
        } else {
          return downloaded === 0
        }
      })
    }

    // 排序
    if (sortBy === 'undownloaded') {
      result = [...result].sort((a, b) => {
        const aUndownloaded = a.aweme_count - a.downloaded_count
        const bUndownloaded = b.aweme_count - b.downloaded_count
        return bUndownloaded - aUndownloaded
      })
    } else if (sortBy === 'total') {
      result = [...result].sort((a, b) => b.aweme_count - a.aweme_count)
    }

    return result
  }, [users, searchTerm, sortBy, showInHomeFilter, autoSyncFilter, downloadStatusFilter])

  const totalPages = Math.ceil(filteredUsers.length / pageSize)
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredUsers.slice(start, start + pageSize)
  }, [filteredUsers, currentPage, pageSize])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, pageSize, sortBy, showInHomeFilter, autoSyncFilter, downloadStatusFilter])

  const checkClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && (text.includes('douyin.com') || text.includes('v.douyin.com'))) {
        const urlMatch = text.match(/https?:\/\/[^\s]+douyin\.com[^\s]*/i)
        if (urlMatch) {
          const detectedUrl = urlMatch[0]
          const result = await window.api.douyin.parseUrl(detectedUrl)
          setClipboardStatus({
            detected: true,
            type: result.type,
            url: detectedUrl
          })
          setUrl(detectedUrl)
          return
        }
      }
      setClipboardStatus({ detected: false, type: null, url: '' })
    } catch {
      setClipboardStatus({ detected: false, type: null, url: '' })
    }
  }, [])

  useEffect(() => {
    if (open) {
      checkClipboard()
    } else {
      setClipboardStatus({ detected: false, type: null, url: '' })
    }
  }, [open, checkClipboard])

  const loadUsers = async () => {
    const data = await window.api.user.getAll()
    setUsers(data)
  }

  const handleAddUser = async () => {
    if (!url.trim()) {
      toast.error('请输入链接')
      return
    }

    setLoading(true)
    try {
      const user = await window.api.user.add(url.trim())
      toast.success(`用户 ${user.nickname} 添加成功`)
      setOpen(false)
      setUrl('')
      setClipboardStatus({ detected: false, type: null, url: '' })
      loadUsers()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async (user: DbUser) => {
    setRefreshingId(user.id)
    try {
      await window.api.user.refresh(user.id, user.homepage_url)
      toast.success('用户信息已更新')
      loadUsers()
    } catch {
      toast.error('更新失败')
    } finally {
      setRefreshingId(null)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await window.api.user.delete(id)
      toast.success('用户已删除')
      loadUsers()
    } catch {
      toast.error('删除失败')
    }
  }

  const handleBatchRefresh = async () => {
    if (users.length === 0) {
      toast.error('没有可刷新的用户')
      return
    }

    setBatchRefreshing(true)
    toast.info(`开始刷新 ${users.length} 个用户...`)

    try {
      const usersToRefresh = users.map((u) => ({
        id: u.id,
        homepage_url: u.homepage_url,
        nickname: u.nickname
      }))
      const result = await window.api.user.batchRefresh(usersToRefresh)

      if (result.success > 0) {
        toast.success(`刷新完成: ${result.success} 成功, ${result.failed} 失败`)
      } else {
        toast.error(`刷新失败: ${result.failed} 个用户`)
      }

      loadUsers()
    } catch {
      toast.error('批量刷新失败')
    } finally {
      setBatchRefreshing(false)
    }
  }

  const formatNumber = (num: number) => {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w'
    }
    return num.toString()
  }

  const handleToggleShowInHome = async (user: DbUser) => {
    try {
      await window.api.user.setShowInHome(user.id, !user.show_in_home)
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, show_in_home: u.show_in_home ? 0 : 1 } : u))
      )
    } catch {
      toast.error('更新失败')
    }
  }

  const handleOpenEdit = (user: DbUser) => {
    setEditingUser(user)
    setEditForm({
      remark: user.remark || '',
      max_download_count: user.max_download_count || 0,
      show_in_home: !!user.show_in_home,
      auto_sync: !!user.auto_sync,
      sync_cron: user.sync_cron || ''
    })
    setCronValid(true)
  }

  const handleSaveEdit = async () => {
    if (!editingUser) return
    if (editForm.auto_sync && editForm.sync_cron) {
      const valid = await window.api.sync.validateCron(editForm.sync_cron)
      if (!valid) {
        setCronValid(false)
        toast.error('Cron 表达式无效')
        return
      }
    }
    setEditLoading(true)
    try {
      await window.api.user.updateSettings(editingUser.id, {
        remark: editForm.remark,
        max_download_count: editForm.max_download_count,
        show_in_home: editForm.show_in_home,
        auto_sync: editForm.auto_sync,
        sync_cron: editForm.sync_cron
      })
      await window.api.sync.updateUserSchedule(editingUser.id)
      toast.success('保存成功')
      setEditingUser(null)
      loadUsers()
    } catch {
      toast.error('保存失败')
    } finally {
      setEditLoading(false)
    }
  }

  const handleToggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    if (selectedIds.size === filteredUsers.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredUsers.map((u) => u.id)))
    }
  }

  const handleOpenBatchEdit = () => {
    if (selectedIds.size === 0) {
      toast.error('请先选择用户')
      return
    }
    setBatchForm({ max_download_count: 0, show_in_home: true })
    setBatchEditOpen(true)
  }

  const handleSaveBatchEdit = async () => {
    setBatchLoading(true)
    try {
      await window.api.user.batchUpdateSettings(Array.from(selectedIds), {
        max_download_count: batchForm.max_download_count,
        show_in_home: batchForm.show_in_home
      })
      toast.success(`已更新 ${selectedIds.size} 个用户`)
      setBatchEditOpen(false)
      setSelectedIds(new Set())
      loadUsers()
    } catch {
      toast.error('批量更新失败')
    } finally {
      setBatchLoading(false)
    }
  }

  const handleStartSync = async (user: DbUser) => {
    if (syncingUserId !== null) {
      toast.error('已有用户正在同步中')
      return
    }
    try {
      setSyncingUserId(user.id)
      await window.api.sync.start(user.id)
    } catch (error) {
      setSyncingUserId(null)
      toast.error(error instanceof Error ? error.message : '同步失败')
    }
  }

  const handleStopSync = async (userId: number) => {
    try {
      await window.api.sync.stop(userId)
      toast.info('正在停止同步...')
    } catch {
      toast.error('停止同步失败')
    }
  }

  const handleBatchCreateDownloadTask = async () => {
    if (selectedIds.size === 0) {
      toast.error('请先选择用户')
      return
    }
    try {
      const selectedUsers = users.filter((u) => selectedIds.has(u.id))
      const names = selectedUsers.map((u) => u.nickname).join('、')
      const displayName = names.length > 20 ? names.substring(0, 20) + '...' : names
      const task = await window.api.task.create({
        name: `下载 ${displayName}`,
        user_ids: Array.from(selectedIds)
      })
      toast.success(`已创建任务: ${task.name}`, {
        action: {
          label: '开始下载',
          onClick: () => window.api.download.start(task.id)
        }
      })
      setSelectedIds(new Set())
    } catch {
      toast.error('创建任务失败')
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-[#EAE6E1] bg-white">
        <h1 className="text-xl font-semibold text-[#312E2A]">用户管理</h1>
        <Button
          onClick={() => setOpen(true)}
          className="bg-[#FE2C55] hover:bg-[#FE2C55]/90 text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          添加用户
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* User List Card */}
        <div className="bg-white rounded-xl border border-[#EAE6E1] overflow-hidden">
          {/* List Header */}
          <div className="flex flex-col border-b border-[#EAE6E1]">
            <div className="h-14 flex items-center justify-between px-5">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-base font-semibold text-[#312E2A]">已添加用户</span>
                  <span className="text-[13px] text-[#B8B2AD]">
                    ({filteredUsers.length}/{users.length})
                  </span>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#B8B2AD]" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="搜索用户..."
                    className="h-9 w-48 pl-9 border-[#EAE6E1] text-sm"
                  />
                </div>
              </div>
            <div className="flex items-center gap-3">
              {selectedIds.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBatchCreateDownloadTask}
                    className="border-[#EAE6E1] text-[#312E2A]"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    批量下载 ({selectedIds.size})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenBatchEdit}
                    className="border-[#EAE6E1] text-[#312E2A]"
                  >
                    <Settings2 className="h-4 w-4 mr-2" />
                    批量编辑
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleBatchRefresh}
                disabled={batchRefreshing || users.length === 0}
                className="border-[#EAE6E1] text-[#312E2A]"
              >
                {batchRefreshing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                刷新全部
              </Button>
            </div>
            </div>

            {/* Filter Row */}
            <div className="h-11 flex items-center gap-4 px-5 bg-[#F7F5F3]/50">
              <div className="flex items-center gap-1.5 text-[#7A7570]">
                <SlidersHorizontal className="h-4 w-4" />
                <span className="text-xs font-medium">筛选</span>
              </div>
              <select
                value={showInHomeFilter}
                onChange={(e) => setShowInHomeFilter(e.target.value as ShowInHomeFilter)}
                className="h-7 px-2 text-xs border border-[#EAE6E1] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#FE2C55]/20"
              >
                <option value="all">首页显示: 全部</option>
                <option value="yes">首页显示: 是</option>
                <option value="no">首页显示: 否</option>
              </select>
              <select
                value={autoSyncFilter}
                onChange={(e) => setAutoSyncFilter(e.target.value as AutoSyncFilter)}
                className="h-7 px-2 text-xs border border-[#EAE6E1] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#FE2C55]/20"
              >
                <option value="all">自动同步: 全部</option>
                <option value="yes">自动同步: 开启</option>
                <option value="no">自动同步: 关闭</option>
              </select>
              <select
                value={downloadStatusFilter}
                onChange={(e) => setDownloadStatusFilter(e.target.value as DownloadStatusFilter)}
                className="h-7 px-2 text-xs border border-[#EAE6E1] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#FE2C55]/20"
              >
                <option value="all">下载状态: 全部</option>
                <option value="completed">下载状态: 已完成</option>
                <option value="partial">下载状态: 部分下载</option>
                <option value="none">下载状态: 未开始</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="h-7 px-2 text-xs border border-[#EAE6E1] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#FE2C55]/20"
              >
                <option value="default">排序: 默认</option>
                <option value="undownloaded">排序: 未下载数</option>
                <option value="total">排序: 总作品数</option>
              </select>
            </div>
          </div>

          {/* Table Header */}
          <div className="h-11 flex items-center px-5 bg-[#F7F5F3] text-[13px] font-medium text-[#7A7570]">
            <div className="w-10">
              <Checkbox
                checked={filteredUsers.length > 0 && selectedIds.size === filteredUsers.length}
                onCheckedChange={handleSelectAll}
              />
            </div>
            <div className="flex-1">用户</div>
            <div className="w-28 text-center">粉丝</div>
            <div className="w-32 text-center">下载进度</div>
            <div className="w-16 text-center">限制</div>
            <div className="w-24 text-center">同步</div>
            <div className="w-20 text-center">首页</div>
            <div className="w-44 text-right">操作</div>
          </div>

          {/* Table Body */}
          {paginatedUsers.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-[#7A7570]">
              <div className="h-16 w-16 rounded-full bg-[#F7F5F3] flex items-center justify-center mb-4">
                <User className="h-8 w-8 text-[#B8B2AD]" />
              </div>
              <p className="text-base font-medium">暂无用户</p>
              <p className="text-sm mt-1 text-[#B8B2AD]">点击上方添加用户按钮开始</p>
            </div>
          ) : (
            paginatedUsers.map((user) => (
              <div
                key={user.id}
                className="h-[72px] flex items-center px-5 border-b border-[#EAE6E1] hover:bg-[#F7F5F3]/50 transition-colors group"
              >
                <div className="w-10">
                  <Checkbox
                    checked={selectedIds.has(user.id)}
                    onCheckedChange={() => handleToggleSelect(user.id)}
                  />
                </div>
                <div className="flex-1 flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user.avatar} className="object-cover" />
                    <AvatarFallback className="bg-[#FEE2E8] text-[#FE2C55]">
                      {user.nickname?.charAt(0).toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium text-[#312E2A] truncate">{user.nickname}</p>
                    <p className="text-xs text-[#B8B2AD] truncate">
                      @{user.unique_id || user.short_id || '-'}
                    </p>
                  </div>
                </div>
                <div className="w-28 text-center">
                  <Badge
                    variant="outline"
                    className="font-medium border-[#EAE6E1] text-[#7A7570]"
                  >
                    {formatNumber(user.follower_count)}
                  </Badge>
                </div>
                <div className="w-32 flex flex-col items-center gap-1">
                  <span className="text-sm font-medium text-[#312E2A]">
                    {user.downloaded_count} / {user.aweme_count}
                  </span>
                  <div className="w-20 h-1.5 bg-[#EAE6E1] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#FE2C55] rounded-full transition-all"
                      style={{
                        width: `${user.aweme_count > 0 ? (user.downloaded_count / user.aweme_count) * 100 : 0}%`
                      }}
                    />
                  </div>
                </div>
                <div className="w-16 text-center">
                  <span className="text-sm text-[#7A7570]">
                    {user.max_download_count > 0 ? user.max_download_count : '-'}
                  </span>
                </div>
                <div className="w-24 flex flex-col items-center gap-1">
                  {syncingUserId === user.id && syncProgress ? (
                    <span className="text-xs text-[#FE2C55]">
                      {syncProgress.downloadedCount}/{syncProgress.totalVideos || '?'}
                    </span>
                  ) : user.auto_sync ? (
                    <Badge variant="outline" className="text-xs border-green-500 text-green-600">
                      <Clock className="h-3 w-3 mr-1" />
                      自动
                    </Badge>
                  ) : (
                    <span className="text-xs text-[#B8B2AD]">手动</span>
                  )}
                </div>
                <div className="w-20 flex justify-center">
                  <Switch
                    checked={!!user.show_in_home}
                    onCheckedChange={() => handleToggleShowInHome(user)}
                  />
                </div>
                <div className="w-44 flex justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                  {syncingUserId === user.id ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#FE2C55] hover:text-[#FE2C55]"
                      onClick={() => handleStopSync(user.id)}
                      title="停止同步"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#7A7570] hover:text-green-600"
                      onClick={() => handleStartSync(user)}
                      disabled={syncingUserId !== null}
                      title="开始同步"
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[#7A7570] hover:text-[#FE2C55]"
                    onClick={() => window.open(user.homepage_url, '_blank')}
                    title="打开主页"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[#7A7570] hover:text-[#312E2A]"
                    onClick={() => handleOpenEdit(user)}
                    title="编辑"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[#7A7570] hover:text-[#312E2A]"
                    onClick={() => handleRefresh(user)}
                    disabled={refreshingId === user.id}
                    title="刷新信息"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${refreshingId === user.id ? 'animate-spin' : ''}`}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[#7A7570] hover:text-[#FE2C55]"
                    onClick={() => handleDelete(user.id)}
                    title="删除用户"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}

          {/* Pagination */}
          {filteredUsers.length > 0 && (
            <div className="h-14 flex items-center justify-between px-5 border-t border-[#EAE6E1]">
              <div className="flex items-center gap-4">
                <span className="text-sm text-[#7A7570]">
                  第 {currentPage} / {totalPages || 1} 页
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#7A7570]">每页</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="h-8 px-2 text-sm border border-[#EAE6E1] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#FE2C55]/20"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-[#7A7570]">条</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="border-[#EAE6E1]"
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className="border-[#EAE6E1]"
                >
                  下一页
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add User Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden" showCloseButton={false}>
          <div className="h-[60px] flex items-center justify-between px-6 border-b border-[#EAE6E1]">
            <h2 className="text-lg font-semibold text-[#312E2A]">添加抖音用户</h2>
            <button
              onClick={() => setOpen(false)}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[#F7F5F3] transition-colors"
            >
              <X className="h-5 w-5 text-[#B8B2AD]" />
            </button>
          </div>
          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#312E2A]">用户主页链接</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.douyin.com/user/..."
                disabled={loading}
                className="h-11 border-[#EAE6E1]"
              />
            </div>
            <div className="space-y-3">
              <Label className="text-sm font-medium text-[#312E2A]">下载内容类型</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 rounded-lg border border-[#FE2C55] bg-[#FEE2E8]/30 cursor-pointer">
                  <input type="radio" name="type" value="all" defaultChecked className="sr-only" />
                  <div className="h-5 w-5 rounded-full border-2 border-[#FE2C55] flex items-center justify-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-[#FE2C55]" />
                  </div>
                  <div>
                    <p className="font-medium text-[#312E2A]">作品</p>
                    <p className="text-xs text-[#7A7570]">下载用户发布的所有作品</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-[#EAE6E1] cursor-pointer hover:bg-[#F7F5F3] transition-colors">
                  <input type="radio" name="type" value="video" className="sr-only" />
                  <div className="h-5 w-5 rounded-full border-2 border-[#EAE6E1]" />
                  <div>
                    <p className="font-medium text-[#312E2A]">视频</p>
                    <p className="text-xs text-[#7A7570]">仅下载用户发布的视频作品(不含图文)</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 rounded-lg border border-[#EAE6E1] cursor-pointer hover:bg-[#F7F5F3] transition-colors">
                  <input type="radio" name="type" value="liked" className="sr-only" />
                  <div className="h-5 w-5 rounded-full border-2 border-[#EAE6E1]" />
                  <div>
                    <p className="font-medium text-[#312E2A]">喜欢</p>
                    <p className="text-xs text-[#7A7570]">下载用户点赞的所有公开作品</p>
                  </div>
                </label>
              </div>
            </div>
          </div>
          <div className="h-[72px] flex items-center justify-end gap-3 px-6 border-t border-[#EAE6E1]">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="h-10 px-5 border-[#EAE6E1]"
            >
              取消
            </Button>
            <Button
              onClick={handleAddUser}
              disabled={loading || !url.trim()}
              className="h-10 px-5 bg-[#FE2C55] hover:bg-[#FE2C55]/90 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  获取中...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  添加用户
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
            <DialogDescription>修改 {editingUser?.nickname} 的设置</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>备注</Label>
              <Input
                value={editForm.remark}
                onChange={(e) => setEditForm((f) => ({ ...f, remark: e.target.value }))}
                placeholder="添加备注..."
              />
            </div>
            <div className="space-y-2">
              <Label>单次下载限制</Label>
              <Input
                type="number"
                min={0}
                value={editForm.max_download_count}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, max_download_count: parseInt(e.target.value) || 0 }))
                }
                placeholder="0 表示使用全局设置"
              />
              <p className="text-xs text-muted-foreground">设为 0 则使用系统全局设置</p>
            </div>
            <div className="flex items-center justify-between">
              <Label>在首页显示</Label>
              <Switch
                checked={editForm.show_in_home}
                onCheckedChange={(checked) => setEditForm((f) => ({ ...f, show_in_home: checked }))}
              />
            </div>
            <div className="border-t border-[#EAE6E1] pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>自动同步</Label>
                  <p className="text-xs text-muted-foreground">按计划自动下载新作品</p>
                </div>
                <Switch
                  checked={editForm.auto_sync}
                  onCheckedChange={(checked) => setEditForm((f) => ({ ...f, auto_sync: checked }))}
                />
              </div>
              {editForm.auto_sync && (
                <div className="space-y-2">
                  <Label>同步计划 (Cron 表达式)</Label>
                  <Input
                    value={editForm.sync_cron}
                    onChange={(e) => {
                      setEditForm((f) => ({ ...f, sync_cron: e.target.value }))
                      setCronValid(true)
                    }}
                    placeholder="0 8 * * *"
                    className={!cronValid ? 'border-red-500' : ''}
                  />
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>常用示例:</p>
                    <p className="font-mono">0 8 * * * - 每天 8:00</p>
                    <p className="font-mono">0 */6 * * * - 每 6 小时</p>
                    <p className="font-mono">0 8 * * 1 - 每周一 8:00</p>
                  </div>
                  {!cronValid && <p className="text-xs text-red-500">Cron 表达式无效</p>}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)} disabled={editLoading}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} disabled={editLoading}>
              {editLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Edit Dialog */}
      <Dialog open={batchEditOpen} onOpenChange={setBatchEditOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>批量编辑</DialogTitle>
            <DialogDescription>批量修改 {selectedIds.size} 个用户的设置</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>单次下载限制</Label>
              <Input
                type="number"
                min={0}
                value={batchForm.max_download_count}
                onChange={(e) =>
                  setBatchForm((f) => ({
                    ...f,
                    max_download_count: parseInt(e.target.value) || 0
                  }))
                }
                placeholder="0 表示使用全局设置"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>在首页显示</Label>
              <Switch
                checked={batchForm.show_in_home}
                onCheckedChange={(checked) => setBatchForm((f) => ({ ...f, show_in_home: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchEditOpen(false)} disabled={batchLoading}>
              取消
            </Button>
            <Button onClick={handleSaveBatchEdit} disabled={batchLoading}>
              {batchLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              应用到 {selectedIds.size} 个用户
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
