import { useState, useEffect, useMemo } from 'react'
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
import { usersApi, syncApi, tasksApi, downloadApi } from '@/api/client'
import { useWsChannel } from '@/hooks/useWebSocket'
import type { DbUser, SyncProgress } from '@dym/shared'

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
    show_in_home: true,
    auto_sync: false,
    sync_cron: ''
  })
  const [batchEnabled, setBatchEnabled] = useState({
    max_download_count: false,
    show_in_home: false,
    auto_sync: false,
    sync_cron: false
  })
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchCronValid, setBatchCronValid] = useState(true)

  const [syncingUserId, setSyncingUserId] = useState<number | null>(null)
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)

  useEffect(() => {
    loadUsers()
    syncApi.getAnySyncing().then(setSyncingUserId)
  }, [])

  useWsChannel('sync:progress', (progress) => {
    setSyncProgress(progress)
    if (
      progress.status === 'completed' ||
      progress.status === 'failed' ||
      progress.status === 'stopped'
    ) {
      setSyncingUserId(null)
      loadUsers()
    }
  })

  const filteredUsers = useMemo(() => {
    let result = users

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      result = result.filter(
        (u) =>
          u.nickname?.toLowerCase().includes(term) ||
          u.unique_id?.toLowerCase().includes(term) ||
          u.short_id?.toLowerCase().includes(term)
      )
    }

    if (showInHomeFilter !== 'all') {
      result = result.filter((u) =>
        showInHomeFilter === 'yes' ? !!u.show_in_home : !u.show_in_home
      )
    }

    if (autoSyncFilter !== 'all') {
      result = result.filter((u) => (autoSyncFilter === 'yes' ? !!u.auto_sync : !u.auto_sync))
    }

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

  const loadUsers = async () => {
    const data = await usersApi.getAll()
    setUsers(data)
  }

  const handleAddUser = async () => {
    if (!url.trim()) {
      toast.error('请输入链接')
      return
    }

    setLoading(true)
    try {
      const user = await usersApi.add(url.trim())
      toast.success(`用户 ${user.nickname} 添加成功`)
      setOpen(false)
      setUrl('')
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
      await usersApi.refresh(user.id)
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
      await usersApi.delete(id)
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
      const result = await usersApi.batchRefresh(usersToRefresh)

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
      await usersApi.updateSettings(user.id, { show_in_home: !user.show_in_home })
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
      const valid = await syncApi.validateCron(editForm.sync_cron)
      if (!valid) {
        setCronValid(false)
        toast.error('Cron 表达式无效')
        return
      }
    }
    setEditLoading(true)
    try {
      await usersApi.updateSettings(editingUser.id, {
        remark: editForm.remark,
        max_download_count: editForm.max_download_count,
        show_in_home: editForm.show_in_home,
        auto_sync: editForm.auto_sync,
        sync_cron: editForm.sync_cron
      })
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
    setBatchForm({ max_download_count: 0, show_in_home: true, auto_sync: false, sync_cron: '' })
    setBatchEnabled({ max_download_count: false, show_in_home: false, auto_sync: false, sync_cron: false })
    setBatchCronValid(true)
    setBatchEditOpen(true)
  }

  const handleSaveBatchEdit = async () => {
    const hasEnabled = Object.values(batchEnabled).some(Boolean)
    if (!hasEnabled) {
      toast.error('请至少勾选一个要修改的设置项')
      return
    }
    if (batchEnabled.auto_sync && batchForm.auto_sync && batchEnabled.sync_cron && batchForm.sync_cron) {
      const valid = await syncApi.validateCron(batchForm.sync_cron)
      if (!valid) {
        setBatchCronValid(false)
        toast.error('Cron 表达式无效')
        return
      }
    }
    setBatchLoading(true)
    try {
      const input: Record<string, unknown> = {}
      if (batchEnabled.max_download_count) input.max_download_count = batchForm.max_download_count
      if (batchEnabled.show_in_home) input.show_in_home = batchForm.show_in_home
      if (batchEnabled.auto_sync) input.auto_sync = batchForm.auto_sync
      if (batchEnabled.sync_cron) input.sync_cron = batchForm.sync_cron
      await usersApi.batchUpdateSettings(Array.from(selectedIds), input as any)
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
      await syncApi.start(user.id)
    } catch (error) {
      setSyncingUserId(null)
      toast.error(error instanceof Error ? error.message : '同步失败')
    }
  }

  const handleStopSync = async (userId: number) => {
    try {
      await syncApi.stop(userId)
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
      const task = await tasksApi.create({
        name: `下载 ${displayName}`,
        user_ids: Array.from(selectedIds)
      })
      toast.success(`已创建任务: ${task.name}`, {
        action: {
          label: '开始下载',
          onClick: () => downloadApi.start(task.id)
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
      <header className="h-16 flex items-center justify-between px-6 border-b border-[#E5E5E7] bg-white">
        <h1 className="text-xl font-semibold text-[#1D1D1F]">用户管理</h1>
        <Button
          onClick={() => setOpen(true)}
          className="bg-[#0A84FF] hover:bg-[#0A84FF]/90 text-white"
        >
          <Plus className="h-4 w-4 mr-2" />
          添加用户
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="mx-auto max-w-6xl">
          <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm overflow-hidden">
            {/* List Header */}
            <div className="border-b border-[#E5E5E7] px-5 py-4 space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-[#1D1D1F]">用户列表</span>
                    <span className="text-[13px] text-[#A1A1A6]">
                      ({filteredUsers.length}/{users.length})
                    </span>
                  </div>
                  <p className="text-xs text-[#6E6E73] mt-1">管理用户、同步与下载策略</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedIds.size > 0 && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBatchCreateDownloadTask}
                        className="border-[#E5E5E7] text-[#1D1D1F]"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        批量下载 ({selectedIds.size})
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenBatchEdit}
                        className="border-[#E5E5E7] text-[#1D1D1F]"
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
                    className="border-[#E5E5E7] text-[#1D1D1F]"
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

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#A1A1A6]" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="搜索用户..."
                    className="h-10 w-full pl-9 border-[#E5E5E7] text-sm"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-[#6E6E73]">
                  <SlidersHorizontal className="h-4 w-4" />
                  <span className="font-medium">筛选条件</span>
                </div>
              </div>
            </div>

            {/* Filter Row */}
            <div className="border-b border-[#E5E5E7] px-5 py-3 bg-[#F5F5F7]/60">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={showInHomeFilter}
                  onChange={(e) => setShowInHomeFilter(e.target.value as ShowInHomeFilter)}
                  className="h-9 px-3 text-xs border border-[#E5E5E7] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20"
                >
                  <option value="all">首页显示: 全部</option>
                  <option value="yes">首页显示: 是</option>
                  <option value="no">首页显示: 否</option>
                </select>
                <select
                  value={autoSyncFilter}
                  onChange={(e) => setAutoSyncFilter(e.target.value as AutoSyncFilter)}
                  className="h-9 px-3 text-xs border border-[#E5E5E7] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20"
                >
                  <option value="all">自动同步: 全部</option>
                  <option value="yes">自动同步: 开启</option>
                  <option value="no">自动同步: 关闭</option>
                </select>
                <select
                  value={downloadStatusFilter}
                  onChange={(e) => setDownloadStatusFilter(e.target.value as DownloadStatusFilter)}
                  className="h-9 px-3 text-xs border border-[#E5E5E7] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20"
                >
                  <option value="all">下载状态: 全部</option>
                  <option value="completed">下载状态: 已完成</option>
                  <option value="partial">下载状态: 部分下载</option>
                  <option value="none">下载状态: 未开始</option>
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="h-9 px-3 text-xs border border-[#E5E5E7] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20"
                >
                  <option value="default">排序: 默认</option>
                  <option value="undownloaded">排序: 未下载数</option>
                  <option value="total">排序: 总作品数</option>
                </select>
              </div>
            </div>

            {/* Table Header */}
            <div className="h-12 flex items-center px-5 bg-[#F5F5F7] text-[12px] font-semibold text-[#6E6E73] uppercase tracking-wide">
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
              <div className="py-20 flex flex-col items-center justify-center text-[#6E6E73]">
                <div className="h-16 w-16 rounded-full bg-[#F2F2F4] flex items-center justify-center mb-4">
                  <User className="h-8 w-8 text-[#A1A1A6]" />
                </div>
                <p className="text-base font-medium">暂无用户</p>
                <p className="text-sm mt-1 text-[#A1A1A6]">点击上方添加用户按钮开始</p>
              </div>
            ) : (
              paginatedUsers.map((user) => (
                <div
                  key={user.id}
                  className="h-[72px] flex items-center px-5 border-b border-[#E5E5E7] hover:bg-[#F2F2F4]/50 transition-colors group"
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
                      <AvatarFallback className="bg-[#E8F0FE] text-[#0A84FF]">
                        {user.nickname?.charAt(0).toUpperCase() || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="font-medium text-[#1D1D1F] truncate">{user.nickname}</p>
                      <p className="text-xs text-[#A1A1A6] truncate">
                        @{user.unique_id || user.short_id || '-'}
                      </p>
                    </div>
                  </div>
                  <div className="w-28 text-center">
                    <Badge
                      variant="outline"
                      className="font-medium border-[#E5E5E7] text-[#6E6E73]"
                    >
                      {formatNumber(user.follower_count)}
                    </Badge>
                  </div>
                  <div className="w-32 flex flex-col items-center gap-1">
                    <span className="text-sm font-medium text-[#1D1D1F]">
                      {user.downloaded_count} / {user.aweme_count}
                    </span>
                    <div className="w-20 h-1.5 bg-[#E5E5E7] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0A84FF] rounded-full transition-all"
                        style={{
                          width: `${user.aweme_count > 0 ? (user.downloaded_count / user.aweme_count) * 100 : 0}%`
                        }}
                      />
                    </div>
                  </div>
                  <div className="w-16 text-center">
                    <span className="text-sm text-[#6E6E73]">
                      {user.max_download_count > 0 ? user.max_download_count : '-'}
                    </span>
                  </div>
                  <div className="w-24 flex flex-col items-center gap-1">
                    {syncingUserId === user.id && syncProgress ? (
                      <span className="text-xs text-[#0A84FF]">
                        {syncProgress.downloadedCount}/{syncProgress.totalVideos || '?'}
                      </span>
                    ) : user.auto_sync ? (
                      <Badge variant="outline" className="text-xs border-green-500 text-green-600">
                        <Clock className="h-3 w-3 mr-1" />
                        自动
                      </Badge>
                    ) : (
                      <span className="text-xs text-[#A1A1A6]">手动</span>
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
                        className="h-8 w-8 text-[#0A84FF] hover:text-[#0A84FF]"
                        onClick={() => handleStopSync(user.id)}
                        title="停止同步"
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-[#6E6E73] hover:text-green-600"
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
                      className="h-8 w-8 text-[#6E6E73] hover:text-[#0A84FF]"
                      onClick={() => window.open(user.homepage_url, '_blank')}
                      title="打开主页"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#6E6E73] hover:text-[#1D1D1F]"
                      onClick={() => handleOpenEdit(user)}
                      title="编辑"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[#6E6E73] hover:text-[#1D1D1F]"
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
                      className="h-8 w-8 text-[#6E6E73] hover:text-[#0A84FF]"
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
              <div className="h-14 flex items-center justify-between px-5 border-t border-[#E5E5E7]">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-[#6E6E73]">
                    第 {currentPage} / {totalPages || 1} 页
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#6E6E73]">每页</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-8 px-2 text-sm border border-[#E5E5E7] rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm text-[#6E6E73]">条</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="border-[#E5E5E7]"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages || totalPages === 0}
                    className="border-[#E5E5E7]"
                  >
                    下一页
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add User Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden" showCloseButton={false}>
          <div className="h-[60px] flex items-center justify-between px-6 border-b border-[#E5E5E7]">
            <h2 className="text-lg font-semibold text-[#1D1D1F]">添加抖音用户</h2>
            <button
              onClick={() => setOpen(false)}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[#F2F2F4] transition-colors"
            >
              <X className="h-5 w-5 text-[#A1A1A6]" />
            </button>
          </div>
          <div className="p-6 space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[#1D1D1F]">用户主页链接</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.douyin.com/user/..."
                disabled={loading}
                className="h-11 border-[#E5E5E7]"
              />
            </div>
          </div>
          <div className="h-[72px] flex items-center justify-end gap-3 px-6 border-t border-[#E5E5E7]">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="h-10 px-5 border-[#E5E5E7]"
            >
              取消
            </Button>
            <Button
              onClick={handleAddUser}
              disabled={loading || !url.trim()}
              className="h-10 px-5 bg-[#0A84FF] hover:bg-[#0A84FF]/90 text-white"
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
            <div className="border-t border-[#E5E5E7] pt-4 space-y-4">
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
            <p className="text-xs text-[#6E6E73]">勾选需要修改的设置项，未勾选的将保持原值不变</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={batchEnabled.max_download_count}
                  onCheckedChange={(checked) =>
                    setBatchEnabled((e) => ({ ...e, max_download_count: !!checked }))
                  }
                />
                <Label className={!batchEnabled.max_download_count ? 'text-[#A1A1A6]' : ''}>
                  单次下载限制
                </Label>
              </div>
              <Input
                type="number"
                min={0}
                disabled={!batchEnabled.max_download_count}
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
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={batchEnabled.show_in_home}
                  onCheckedChange={(checked) =>
                    setBatchEnabled((e) => ({ ...e, show_in_home: !!checked }))
                  }
                />
                <Label className={!batchEnabled.show_in_home ? 'text-[#A1A1A6]' : ''}>
                  在首页显示
                </Label>
              </div>
              <Switch
                disabled={!batchEnabled.show_in_home}
                checked={batchForm.show_in_home}
                onCheckedChange={(checked) =>
                  setBatchForm((f) => ({ ...f, show_in_home: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={batchEnabled.auto_sync}
                  onCheckedChange={(checked) =>
                    setBatchEnabled((e) => ({ ...e, auto_sync: !!checked }))
                  }
                />
                <Label className={!batchEnabled.auto_sync ? 'text-[#A1A1A6]' : ''}>
                  自动同步
                </Label>
              </div>
              <Switch
                disabled={!batchEnabled.auto_sync}
                checked={batchForm.auto_sync}
                onCheckedChange={(checked) =>
                  setBatchForm((f) => ({ ...f, auto_sync: checked }))
                }
              />
            </div>
            {batchEnabled.auto_sync && batchForm.auto_sync && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={batchEnabled.sync_cron}
                    onCheckedChange={(checked) =>
                      setBatchEnabled((e) => ({ ...e, sync_cron: !!checked }))
                    }
                  />
                  <Label className={!batchEnabled.sync_cron ? 'text-[#A1A1A6]' : ''}>
                    同步计划 (Cron)
                  </Label>
                </div>
                <Input
                  disabled={!batchEnabled.sync_cron}
                  value={batchForm.sync_cron}
                  onChange={(e) => {
                    setBatchForm((f) => ({ ...f, sync_cron: e.target.value }))
                    setBatchCronValid(true)
                  }}
                  placeholder="0 8 * * *"
                  className={!batchCronValid ? 'border-red-500' : ''}
                />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-mono">0 8 * * * - 每天 8:00</p>
                  <p className="font-mono">0 */6 * * * - 每 6 小时</p>
                </div>
                {!batchCronValid && <p className="text-xs text-red-500">Cron 表达式无效</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBatchEditOpen(false)}
              disabled={batchLoading}
            >
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
