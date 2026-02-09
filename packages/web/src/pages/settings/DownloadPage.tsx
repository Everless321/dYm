import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Plus,
  FileText,
  Pencil,
  Trash2,
  Download,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Timer,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { tasksApi, usersApi, syncApi } from '@/api/client'
import type { DbTaskWithUsers, DbUser } from '@dym/shared'

const PAGE_SIZE = 10

const statusConfig = {
  pending: { label: '待执行', icon: Clock, color: 'text-[#6E6E73]', bg: 'bg-[#F2F2F4]' },
  running: { label: '执行中', icon: Loader2, color: 'text-[#0A84FF]', bg: 'bg-[#E8F0FE]' },
  completed: { label: '已完成', icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
  failed: { label: '失败', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' }
}

export default function DownloadPage() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<DbTaskWithUsers[]>([])
  const [users, setUsers] = useState<DbUser[]>([])
  const [open, setOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<DbTaskWithUsers | null>(null)
  const [taskName, setTaskName] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([])
  const [concurrency, setConcurrency] = useState('3')
  const [autoSync, setAutoSync] = useState(false)
  const [syncCron, setSyncCron] = useState('')
  const [cronError, setCronError] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    loadTasks()
    loadUsers()
  }, [])

  const loadTasks = async () => {
    const data = await tasksApi.getAll()
    setTasks(data)
  }

  const loadUsers = async () => {
    const data = await usersApi.getAll()
    setUsers(data)
  }

  const totalPages = Math.ceil(tasks.length / PAGE_SIZE)
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return tasks.slice(start, start + PAGE_SIZE)
  }, [tasks, currentPage])

  const generateTaskName = (userIds: number[]) => {
    if (userIds.length === 0) return ''
    const selectedUsers = users.filter((u) => userIds.includes(u.id))
    const date = new Date().toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    if (selectedUsers.length === 1) {
      return `${selectedUsers[0].nickname} - ${date}`
    }
    return `${selectedUsers[0].nickname} 等${selectedUsers.length}人 - ${date}`
  }

  const handleOpenAdd = () => {
    setEditingTask(null)
    setTaskName('')
    setSelectedUserIds([])
    setConcurrency('3')
    setAutoSync(false)
    setSyncCron('')
    setCronError('')
    setOpen(true)
  }

  const handleOpenEdit = (task: DbTaskWithUsers) => {
    setEditingTask(task)
    setTaskName(task.name)
    setSelectedUserIds(task.users.map((u) => u.id))
    setConcurrency(String(task.concurrency))
    setAutoSync(Boolean(task.auto_sync))
    setSyncCron(task.sync_cron || '')
    setCronError('')
    setOpen(true)
  }

  const handleUserToggle = (userId: number) => {
    setSelectedUserIds((prev) => {
      const next = prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
      if (!editingTask) {
        setTaskName(generateTaskName(next))
      }
      return next
    })
  }

  const handleSelectAll = () => {
    if (selectedUserIds.length === users.length) {
      setSelectedUserIds([])
      if (!editingTask) setTaskName('')
    } else {
      const allIds = users.map((u) => u.id)
      setSelectedUserIds(allIds)
      if (!editingTask) setTaskName(generateTaskName(allIds))
    }
  }

  const validateCron = async (expression: string): Promise<boolean> => {
    if (!expression.trim()) return true
    return await syncApi.validateCron(expression)
  }

  const handleSave = async () => {
    if (!taskName.trim()) {
      toast.error('请输入任务名称')
      return
    }
    if (selectedUserIds.length === 0) {
      toast.error('请选择至少一个用户')
      return
    }

    if (autoSync && syncCron) {
      const valid = await validateCron(syncCron)
      if (!valid) {
        setCronError('无效的 cron 表达式')
        toast.error('无效的 cron 表达式')
        return
      }
    }

    setLoading(true)
    const concurrencyNum = parseInt(concurrency) || 3
    try {
      if (editingTask) {
        await tasksApi.update(editingTask.id, {
          name: taskName.trim(),
          concurrency: concurrencyNum,
          auto_sync: autoSync,
          sync_cron: syncCron.trim()
        })
        await tasksApi.updateUsers(editingTask.id, selectedUserIds)
        toast.success('任务已更新')
      } else {
        await tasksApi.create({
          name: taskName.trim(),
          user_ids: selectedUserIds,
          concurrency: concurrencyNum,
          auto_sync: autoSync,
          sync_cron: syncCron.trim()
        })
        toast.success('任务已创建')
      }
      setOpen(false)
      loadTasks()
    } catch {
      toast.error(editingTask ? '更新失败' : '创建失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await tasksApi.delete(id)
      toast.success('任务已删除')
      loadTasks()
    } catch {
      toast.error('删除失败')
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="h-16 flex items-center justify-between px-6 border-b border-[#E5E5E7] bg-white">
        <h1 className="text-xl font-semibold text-[#1D1D1F]">视频下载</h1>
        <Button onClick={handleOpenAdd} className="bg-[#0A84FF] hover:bg-[#0A84FF]/90 text-white">
          <Plus className="h-4 w-4 mr-2" />
          添加任务
        </Button>
      </header>

      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm overflow-hidden">
            <div className="h-14 flex items-center justify-between px-5 border-b border-[#E5E5E7]">
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-[#1D1D1F]">任务列表</span>
                <span className="text-[13px] text-[#A1A1A6]">({tasks.length})</span>
              </div>
            </div>

            <div className="h-12 flex items-center px-5 bg-[#F5F5F7] text-[12px] font-semibold text-[#6E6E73] uppercase tracking-wide">
              <div className="w-[260px]">任务名称</div>
              <div className="flex-1">用户</div>
              <div className="w-24 text-center">状态</div>
              <div className="w-32 text-center">定时同步</div>
              <div className="w-32 text-center">创建时间</div>
              <div className="w-32 text-right">操作</div>
            </div>

            {paginatedTasks.length === 0 ? (
              <div className="py-20 flex flex-col items-center justify-center text-[#6E6E73]">
                <div className="h-16 w-16 rounded-full bg-[#F2F2F4] flex items-center justify-center mb-4">
                  <Download className="h-8 w-8 text-[#A1A1A6]" />
                </div>
                <p className="text-base font-medium">暂无任务</p>
                <p className="text-sm mt-1 text-[#A1A1A6]">点击上方"添加任务"按钮开始</p>
              </div>
            ) : (
              paginatedTasks.map((task) => {
                const status = statusConfig[task.status]
                const StatusIcon = status.icon
                return (
                  <div
                    key={task.id}
                    className="h-[68px] flex items-center px-5 border-b border-[#E5E5E7] hover:bg-[#F2F2F4]/50 transition-colors group"
                  >
                    <div className="w-[260px] flex items-center gap-3">
                      <FileText className="h-5 w-5 text-[#A1A1A6]" />
                      <span className="font-medium text-[#1D1D1F] truncate">{task.name}</span>
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {task.users.slice(0, 3).map((user) => (
                          <Avatar key={user.id} className="h-7 w-7 border-2 border-white">
                            <AvatarImage src={user.avatar} />
                            <AvatarFallback className="text-xs bg-[#E8F0FE] text-[#0A84FF]">
                              {user.nickname?.charAt(0) || 'U'}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                      {task.users.length > 3 && (
                        <span className="text-xs text-[#A1A1A6]">+{task.users.length - 3}</span>
                      )}
                      <span className="text-sm text-[#6E6E73] ml-1">{task.users.length} 人</span>
                    </div>
                    <div className="w-24 flex justify-center">
                      <Badge className={`gap-1 ${status.bg} ${status.color} border-0`}>
                        <StatusIcon
                          className={`h-3 w-3 ${task.status === 'running' ? 'animate-spin' : ''}`}
                        />
                        {status.label}
                      </Badge>
                    </div>
                    <div className="w-32 flex flex-col items-center gap-0.5">
                      {task.auto_sync && task.sync_cron ? (
                        <>
                          <Badge
                            variant="outline"
                            className="gap-1 text-xs border-green-500 text-green-600"
                          >
                            <Timer className="h-3 w-3" />
                            已开启
                          </Badge>
                          <span className="text-xs text-[#A1A1A6] font-mono">{task.sync_cron}</span>
                        </>
                      ) : (
                        <span className="text-xs text-[#A1A1A6]">未设置</span>
                      )}
                    </div>
                    <div className="w-32 text-center text-sm text-[#6E6E73]">
                      {formatDate(task.created_at)}
                    </div>
                    <div className="w-32 flex justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-[#6E6E73] hover:text-[#1D1D1F]"
                        onClick={() => navigate(`/download/${task.id}`)}
                        title="查看详情"
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-[#6E6E73] hover:text-[#1D1D1F]"
                        onClick={() => handleOpenEdit(task)}
                        title="编辑任务"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-[#6E6E73] hover:text-[#0A84FF]"
                        onClick={() => handleDelete(task.id)}
                        title="删除任务"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })
            )}

            {tasks.length > PAGE_SIZE && (
              <div className="h-14 flex items-center justify-between px-5 border-t border-[#E5E5E7]">
                <span className="text-sm text-[#6E6E73]">
                  第 {currentPage} / {totalPages} 页，共 {tasks.length} 条
                </span>
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
                    disabled={currentPage === totalPages}
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

      {/* Add/Edit Task Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden" showCloseButton={false}>
          <div className="h-[60px] flex items-center justify-between px-6 border-b border-[#E5E5E7]">
            <h2 className="text-lg font-semibold text-[#1D1D1F]">
              {editingTask ? '编辑任务' : '添加下载任务'}
            </h2>
            <button
              onClick={() => setOpen(false)}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-[#F2F2F4] transition-colors"
            >
              <X className="h-5 w-5 text-[#A1A1A6]" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium text-[#1D1D1F]">任务名称</Label>
                <Input
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="输入任务名称..."
                  disabled={loading}
                  className="h-10 border-[#E5E5E7]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium text-[#1D1D1F]">并发数</Label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={concurrency}
                  onChange={(e) => setConcurrency(e.target.value)}
                  placeholder="3"
                  disabled={loading}
                  className="h-10 border-[#E5E5E7]"
                />
                <p className="text-xs text-[#A1A1A6]">同时下载的用户数</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-[#1D1D1F]">选择用户</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAll}
                  disabled={loading}
                  className="text-[#6E6E73] hover:text-[#1D1D1F]"
                >
                  {selectedUserIds.length === users.length ? '取消全选' : '全选'}
                </Button>
              </div>
              <ScrollArea className="h-48 rounded-lg border border-[#E5E5E7]">
                <div className="p-2 space-y-1">
                  {users.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-[#6E6E73]">
                      <p className="text-sm">暂无用户</p>
                      <p className="text-xs mt-1 text-[#A1A1A6]">请先在用户管理中添加用户</p>
                    </div>
                  ) : (
                    users.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#F2F2F4] transition-colors cursor-pointer"
                        onClick={() => handleUserToggle(user.id)}
                      >
                        <Checkbox
                          checked={selectedUserIds.includes(user.id)}
                          onCheckedChange={() => handleUserToggle(user.id)}
                          disabled={loading}
                        />
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.avatar} />
                          <AvatarFallback className="bg-[#E8F0FE] text-[#0A84FF]">
                            {user.nickname?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-[#1D1D1F] truncate text-sm">
                            {user.nickname}
                          </p>
                          <p className="text-xs text-[#A1A1A6]">{user.aweme_count} 个视频</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
              <p className="text-xs text-[#A1A1A6]">已选择 {selectedUserIds.length} 个用户</p>
            </div>

            <div className="p-4 rounded-lg border border-[#E5E5E7] bg-[#F2F2F4]/50 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium text-[#1D1D1F]">定时同步</Label>
                  <p className="text-xs text-[#A1A1A6]">按设定时间自动执行下载任务</p>
                </div>
                <Switch checked={autoSync} onCheckedChange={setAutoSync} disabled={loading} />
              </div>
              {autoSync && (
                <div className="space-y-2 pt-3 border-t border-[#E5E5E7]">
                  <Label className="text-sm font-medium text-[#1D1D1F]">Cron 表达式</Label>
                  <Input
                    value={syncCron}
                    onChange={(e) => {
                      setSyncCron(e.target.value)
                      setCronError('')
                    }}
                    placeholder="0 2 * * *"
                    disabled={loading}
                    className={`h-10 border-[#E5E5E7] ${cronError ? 'border-red-500' : ''}`}
                  />
                  {cronError && <p className="text-xs text-red-500">{cronError}</p>}
                  <div className="text-xs text-[#A1A1A6] space-y-1">
                    <p>常用示例:</p>
                    <p className="font-mono">0 2 * * * - 每天凌晨 2:00</p>
                    <p className="font-mono">0 */6 * * * - 每 6 小时</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="h-[72px] flex items-center justify-end gap-3 px-6 border-t border-[#E5E5E7]">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
              className="h-10 px-5 border-[#E5E5E7]"
            >
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={loading || !taskName.trim() || selectedUserIds.length === 0}
              className="h-10 px-5 bg-[#0A84FF] hover:bg-[#0A84FF]/90 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  {editingTask ? '保存' : '创建'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
