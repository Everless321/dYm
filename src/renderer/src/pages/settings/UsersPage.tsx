import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import {
  Plus,
  RefreshCw,
  Trash2,
  Loader2,
  User,
  ExternalLink,
  Clipboard,
  CheckCircle2,
  RotateCcw,
  Search,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Settings2,
  Download,
  ArrowUpDown
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

type SortOption = 'default' | 'undownloaded' | 'total'

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
  const [clipboardStatus, setClipboardStatus] = useState<{
    detected: boolean
    type: 'user' | 'video' | 'unknown' | null
    url: string
  }>({ detected: false, type: null, url: '' })

  // 编辑相关状态
  const [editingUser, setEditingUser] = useState<DbUser | null>(null)
  const [editForm, setEditForm] = useState({
    remark: '',
    max_download_count: 0,
    show_in_home: true
  })
  const [editLoading, setEditLoading] = useState(false)

  // 批量编辑相关状态
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchEditOpen, setBatchEditOpen] = useState(false)
  const [batchForm, setBatchForm] = useState({
    max_download_count: 0,
    show_in_home: true
  })
  const [batchLoading, setBatchLoading] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [])

  // 搜索过滤和排序
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
  }, [users, searchTerm, sortBy])

  // 分页
  const totalPages = Math.ceil(filteredUsers.length / pageSize)
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredUsers.slice(start, start + pageSize)
  }, [filteredUsers, currentPage, pageSize])

  // 搜索词、分页大小或排序变化时重置页码
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, pageSize, sortBy])

  // 检测剪贴板中的抖音链接
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
      show_in_home: !!user.show_in_home
    })
  }

  const handleSaveEdit = async () => {
    if (!editingUser) return
    setEditLoading(true)
    try {
      await window.api.user.updateSettings(editingUser.id, {
        remark: editForm.remark,
        max_download_count: editForm.max_download_count,
        show_in_home: editForm.show_in_home
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

  const handleCreateDownloadTask = async (user: DbUser) => {
    try {
      const task = await window.api.task.create({
        name: `下载 ${user.nickname}`,
        user_ids: [user.id]
      })
      toast.success(`已创建任务: ${task.name}`, {
        action: {
          label: '开始下载',
          onClick: () => window.api.download.start(task.id)
        }
      })
    } catch {
      toast.error('创建任务失败')
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
    <div className="space-y-4">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">用户管理</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            添加抖音用户主页链接，解析并管理用户数据
          </p>
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <>
              <Button variant="outline" onClick={handleBatchCreateDownloadTask}>
                <Download className="h-4 w-4 mr-2" />
                批量下载 ({selectedIds.size})
              </Button>
              <Button variant="outline" onClick={handleOpenBatchEdit}>
                <Settings2 className="h-4 w-4 mr-2" />
                批量编辑 ({selectedIds.size})
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={handleBatchRefresh}
            disabled={batchRefreshing || users.length === 0}
          >
            {batchRefreshing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            批量刷新
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                添加用户
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px]">
              <DialogHeader className="space-y-3">
                <DialogTitle className="text-xl">添加抖音用户</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  支持用户主页链接或作品链接，系统将自动识别并获取用户信息
                </DialogDescription>
              </DialogHeader>
              <div className="py-5 space-y-4">
                {clipboardStatus.detected && (
                  <div className="flex items-center gap-3 p-3 bg-muted/50 border rounded-lg animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center justify-center h-10 w-10 rounded-full bg-background">
                      <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">
                        已从剪贴板检测到
                        {clipboardStatus.type === 'user' && '用户链接'}
                        {clipboardStatus.type === 'video' && '作品链接'}
                        {clipboardStatus.type === 'unknown' && '抖音链接'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {clipboardStatus.url}
                      </p>
                    </div>
                  </div>
                )}
                <div className="relative group">
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="粘贴用户主页或作品链接..."
                    disabled={loading}
                    className="pr-12 h-12 text-base"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 hover:bg-muted rounded-lg transition-colors group"
                    onClick={async () => {
                      const text = await navigator.clipboard.readText()
                      setUrl(text)
                      checkClipboard()
                    }}
                    disabled={loading}
                    title="从剪贴板粘贴"
                  >
                    <Clipboard className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </button>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">支持链接格式：</p>
                  <p className="text-xs text-muted-foreground/80">
                    • 用户主页：https://www.douyin.com/user/xxx
                  </p>
                  <p className="text-xs text-muted-foreground/80">
                    • 短链接：https://v.douyin.com/xxx
                  </p>
                  <p className="text-xs text-muted-foreground/80">
                    • 作品链接：将自动提取作者信息
                  </p>
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={loading}
                  className="flex-1 sm:flex-none"
                >
                  取消
                </Button>
                <Button
                  onClick={handleAddUser}
                  disabled={loading || !url.trim()}
                  className="flex-1 sm:flex-none"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      获取中...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      添加
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* User List Card */}
      <Card className="overflow-hidden">
        <CardHeader className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold">用户列表</CardTitle>
              <CardDescription className="mt-1">
                已添加 <span className="font-medium text-foreground">{users.length}</span> 个用户
                {searchTerm && (
                  <span className="ml-2">
                    ，筛选出{' '}
                    <span className="font-medium text-foreground">{filteredUsers.length}</span> 个
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索用户名或抖音号..."
                  className="pl-9 w-64"
                />
              </div>
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="h-9 px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="default">默认排序</option>
                  <option value="undownloaded">未下载优先</option>
                  <option value="total">总数优先</option>
                </select>
              </div>
              {users.length > 0 && (
                <Badge variant="secondary" className="px-3 py-1">
                  {users.length} 用户
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">
                  <Checkbox
                    checked={filteredUsers.length > 0 && selectedIds.size === filteredUsers.length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead className="w-[260px] font-semibold">用户</TableHead>
                <TableHead className="font-semibold">抖音号</TableHead>
                <TableHead className="text-center font-semibold">粉丝</TableHead>
                <TableHead className="text-center w-[100px] font-semibold">下载限制</TableHead>
                <TableHead className="text-center w-[140px] font-semibold">下载进度</TableHead>
                <TableHead className="text-center w-[80px] font-semibold">首页</TableHead>
                <TableHead className="text-right w-[140px] font-semibold">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedUsers.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                        <User className="h-8 w-8 opacity-40" />
                      </div>
                      <p className="text-base font-medium">
                        {searchTerm ? '未找到匹配的用户' : '暂无用户'}
                      </p>
                      <p className="text-sm mt-1 opacity-70">
                        {searchTerm ? '尝试其他搜索关键词' : '点击上方"添加用户"按钮开始'}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedUsers.map((user) => (
                  <TableRow key={user.id} className="group transition-colors">
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(user.id)}
                        onCheckedChange={() => handleToggleSelect(user.id)}
                      />
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex items-center gap-4">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={user.avatar} className="object-cover" />
                          <AvatarFallback>
                            {user.nickname?.charAt(0).toUpperCase() || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 space-y-1">
                          <p className="font-semibold truncate text-foreground">{user.nickname}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                            {user.remark || user.signature || '暂无签名'}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground font-mono">
                        @{user.unique_id || user.short_id || '-'}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="font-semibold">
                        {formatNumber(user.follower_count)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm text-muted-foreground">
                        {user.max_download_count > 0 ? user.max_download_count : '全局'}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-sm font-medium">
                          {user.downloaded_count} / {user.aweme_count}
                        </span>
                        <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-foreground rounded-full transition-all"
                            style={{
                              width: `${user.aweme_count > 0 ? (user.downloaded_count / user.aweme_count) * 100 : 0}%`
                            }}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={!!user.show_in_home}
                        onCheckedChange={() => handleToggleShowInHome(user)}
                        title={user.show_in_home ? '点击隐藏' : '点击显示'}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => handleCreateDownloadTask(user)}
                          title="创建下载任务"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => handleOpenEdit(user)}
                          title="编辑"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => window.open(user.homepage_url, '_blank')}
                          title="打开主页"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9"
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
                          className="h-9 w-9 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(user.id)}
                          title="删除用户"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {filteredUsers.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="flex items-center gap-4">
                <p className="text-sm text-muted-foreground">
                  第 {currentPage} / {totalPages || 1} 页，共 {filteredUsers.length} 条
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">每页</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="h-8 px-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-muted-foreground">条</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages || totalPages === 0}
                >
                  下一页
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 编辑用户对话框 */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
            <DialogDescription>
              修改 {editingUser?.nickname} 的设置
            </DialogDescription>
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
              <p className="text-xs text-muted-foreground">
                设为 0 则使用系统全局设置，否则使用此数值
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Label>在首页显示</Label>
              <Switch
                checked={editForm.show_in_home}
                onCheckedChange={(checked) => setEditForm((f) => ({ ...f, show_in_home: checked }))}
              />
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

      {/* 批量编辑对话框 */}
      <Dialog open={batchEditOpen} onOpenChange={setBatchEditOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>批量编辑</DialogTitle>
            <DialogDescription>
              批量修改 {selectedIds.size} 个用户的设置
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>单次下载限制</Label>
              <Input
                type="number"
                min={0}
                value={batchForm.max_download_count}
                onChange={(e) =>
                  setBatchForm((f) => ({ ...f, max_download_count: parseInt(e.target.value) || 0 }))
                }
                placeholder="0 表示使用全局设置"
              />
              <p className="text-xs text-muted-foreground">
                设为 0 则使用系统全局设置，否则使用此数值
              </p>
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
