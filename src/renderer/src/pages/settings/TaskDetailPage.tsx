import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  User,
  Video,
  Calendar,
  FileText,
  Play,
  Square,
  Zap
} from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

const statusConfig = {
  pending: { label: '待执行', icon: Clock, variant: 'secondary' as const, color: 'text-muted-foreground' },
  running: { label: '执行中', icon: Loader2, variant: 'default' as const, color: 'text-blue-500' },
  completed: { label: '已完成', icon: CheckCircle2, variant: 'outline' as const, color: 'text-green-500' },
  failed: { label: '失败', icon: XCircle, variant: 'destructive' as const, color: 'text-red-500' }
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [task, setTask] = useState<DbTaskWithUsers | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [activeUsers, setActiveUsers] = useState<Set<string>>(new Set())
  const lastRefreshRef = useRef<number>(0)

  const handleProgress = useCallback(
    (p: DownloadProgress) => {
      if (p.taskId === parseInt(id || '0')) {
        setProgress(p)
        setIsRunning(p.status === 'running')

        // 更新活跃用户列表
        if (p.status === 'running' && p.currentUser) {
          setActiveUsers((prev) => {
            if (prev.has(p.currentUser!)) return prev
            const next = new Set(prev)
            next.add(p.currentUser!)
            return next
          })
        }

        // 用户完成时从活跃列表移除
        if (p.message?.includes('完成') && p.currentUser) {
          setActiveUsers((prev) => {
            if (!prev.has(p.currentUser!)) return prev
            const next = new Set(prev)
            next.delete(p.currentUser!)
            return next
          })
        }

        if (p.status === 'completed') {
          toast.success(p.message)
          setActiveUsers(new Set())
          loadTask(parseInt(id || '0'))
        } else if (p.status === 'failed') {
          toast.error(p.message)
          setActiveUsers(new Set())
          loadTask(parseInt(id || '0'))
        } else if (p.status === 'running') {
          // 仅每 5 秒刷新一次任务数据
          const now = Date.now()
          if (now - lastRefreshRef.current > 5000) {
            lastRefreshRef.current = now
            loadTask(parseInt(id || '0'))
          }
        }
      }
    },
    [id]
  )

  useEffect(() => {
    if (id) {
      loadTask(parseInt(id))
      window.api.download.isRunning(parseInt(id)).then(setIsRunning)
    }
  }, [id])

  useEffect(() => {
    const unsubscribe = window.api.download.onProgress(handleProgress)
    return () => unsubscribe()
  }, [handleProgress])

  // 将所有正在下载的用户置顶 (必须在所有 hooks 之后、早期 return 之前)
  const sortedUsers = useMemo(() => {
    if (!task) return []
    if (!isRunning || activeUsers.size === 0) return task.users
    return [...task.users].sort((a, b) => {
      const aIsActive = activeUsers.has(a.nickname)
      const bIsActive = activeUsers.has(b.nickname)
      if (aIsActive && !bIsActive) return -1
      if (!aIsActive && bIsActive) return 1
      return 0
    })
  }, [task?.users, isRunning, activeUsers])

  const loadTask = async (taskId: number) => {
    setLoading(true)
    try {
      const data = await window.api.task.getById(taskId)
      if (data) {
        setTask(data)
      } else {
        toast.error('任务不存在')
        navigate('/settings/download')
      }
    } catch {
      toast.error('加载任务失败')
      navigate('/settings/download')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatNumber = (num: number) => {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w'
    }
    return num.toString()
  }

  const handleStartDownload = async () => {
    if (!task) return
    try {
      setIsRunning(true)
      await window.api.download.start(task.id)
    } catch (error) {
      setIsRunning(false)
      toast.error((error as Error).message)
    }
  }

  const handleStopDownload = () => {
    if (!task) return
    window.api.download.stop(task.id)
    toast.info('正在停止下载...')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!task) {
    return null
  }

  const status = statusConfig[task.status]
  const StatusIcon = status.icon
  const totalVideos = task.users.reduce((sum, u) => sum + u.aweme_count, 0)
  const totalDownloaded = task.users.reduce((sum, u) => sum + (u.downloaded_count || 0), 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings/download')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight">{task.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            任务详情 · 并发数: {task.concurrency}
          </p>
        </div>
        <Badge variant={status.variant} className="gap-1 text-sm px-3 py-1">
          <StatusIcon className={`h-4 w-4 ${task.status === 'running' ? 'animate-spin' : ''}`} />
          {status.label}
        </Badge>
        {isRunning ? (
          <Button variant="destructive" onClick={handleStopDownload}>
            <Square className="h-4 w-4 mr-2" />
            停止下载
          </Button>
        ) : (
          <Button onClick={handleStartDownload}>
            <Play className="h-4 w-4 mr-2" />
            开始下载
          </Button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <User className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{task.users.length}</p>
                <p className="text-sm text-muted-foreground">用户数</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Video className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatNumber(totalVideos)}</p>
                <p className="text-sm text-muted-foreground">视频总数</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <FileText className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {totalDownloaded} / {totalVideos}
                </p>
                <p className="text-sm text-muted-foreground">下载进度</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Calendar className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">{formatDate(task.created_at)}</p>
                <p className="text-sm text-muted-foreground">创建时间</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Download Progress */}
      {progress && isRunning && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Zap className="h-5 w-5 text-primary animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{progress.message}</p>
                <p className="text-sm text-muted-foreground">
                  用户 {progress.currentUserIndex}/{progress.totalUsers}
                  {progress.currentUser && ` · ${progress.currentUser}`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">{progress.downloadedPosts}</p>
                <p className="text-xs text-muted-foreground">已下载</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">下载进度</span>
                <span className="font-medium">
                  {progress.currentVideo}/{progress.totalVideos}
                </span>
              </div>
              <Progress
                value={
                  progress.totalVideos > 0
                    ? (progress.currentVideo / progress.totalVideos) * 100
                    : 0
                }
                className="h-2"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Users List */}
      <Card className="overflow-hidden">
        <CardHeader className="p-4">
          <CardTitle className="text-lg font-semibold">包含用户</CardTitle>
          <CardDescription>此任务将下载以下用户的视频</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[280px] font-semibold">用户</TableHead>
                <TableHead className="font-semibold">抖音号</TableHead>
                <TableHead className="text-center font-semibold">粉丝</TableHead>
                <TableHead className="text-center font-semibold">视频数</TableHead>
                <TableHead className="text-center font-semibold">已下载</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedUsers.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <User className="h-8 w-8 opacity-40 mb-2" />
                      <p className="text-sm">暂无用户</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                sortedUsers.map((user) => {
                  const isActiveUser = isRunning && activeUsers.has(user.nickname)
                  return (
                    <TableRow
                      key={user.id}
                      className={isActiveUser ? 'bg-primary/10 border-l-2 border-l-primary' : ''}
                    >
                      <TableCell className="py-3">
                        <div className="flex items-center gap-4">
                          <div className="relative">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={user.avatar} className="object-cover" />
                              <AvatarFallback>
                                {user.nickname?.charAt(0).toUpperCase() || 'U'}
                              </AvatarFallback>
                            </Avatar>
                            {isActiveUser && (
                              <div className="absolute -right-1 -bottom-1 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                                <Loader2 className="h-2.5 w-2.5 text-primary-foreground animate-spin" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium truncate">{user.nickname}</p>
                              {isActiveUser && (
                                <Badge variant="default" className="text-xs px-1.5 py-0">
                                  下载中
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                              {user.signature || '暂无签名'}
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
                        <span className="font-medium">{user.aweme_count}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-sm font-medium">
                            {user.downloaded_count} / {user.aweme_count}
                          </span>
                          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${isActiveUser ? 'bg-primary' : 'bg-foreground'}`}
                              style={{
                                width: `${user.aweme_count > 0 ? (user.downloaded_count / user.aweme_count) * 100 : 0}%`
                              }}
                            />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
