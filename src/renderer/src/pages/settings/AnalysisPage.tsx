import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Play, Square, Sparkles, Clock, CheckCircle, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

export default function AnalysisPage() {
  const [userStats, setUserStats] = useState<UserAnalysisStats[]>([])
  const [totalStats, setTotalStats] = useState<TotalAnalysisStats>({ total: 0, analyzed: 0, unanalyzed: 0 })
  const [isRunning, setIsRunning] = useState(false)
  const [currentSecUid, setCurrentSecUid] = useState<string | null>(null)
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)

  useEffect(() => {
    loadData()
    checkRunningStatus()

    const unsubscribe = window.api.analysis.onProgress((p) => {
      setProgress(p)
      if (p.status === 'completed' || p.status === 'failed' || p.status === 'stopped') {
        setIsRunning(false)
        setCurrentSecUid(null)
        loadData()
      }
    })

    return () => unsubscribe()
  }, [])

  const loadData = async () => {
    const [stats, total] = await Promise.all([
      window.api.analysis.getUserStats(),
      window.api.analysis.getTotalStats()
    ])
    setUserStats(stats)
    setTotalStats(total)
  }

  const checkRunningStatus = async () => {
    const running = await window.api.analysis.isRunning()
    setIsRunning(running)
  }

  const handleStart = async (secUid?: string) => {
    try {
      setIsRunning(true)
      setCurrentSecUid(secUid || null)
      setProgress(null)
      await window.api.analysis.start(secUid)
    } catch (error) {
      toast.error((error as Error).message)
      setIsRunning(false)
      setCurrentSecUid(null)
    }
  }

  const handleStop = async () => {
    try {
      await window.api.analysis.stop()
      toast.info('正在停止分析...')
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  const progressPercent = progress?.totalPosts
    ? Math.round(((progress.analyzedCount + progress.failedCount) / progress.totalPosts) * 100)
    : 0

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">视频分析</h2>
        <p className="text-sm text-muted-foreground mt-1">
          使用 Grok API 对视频进行智能分析和标签
        </p>
      </div>

      {/* Stats Cards - 放在最上面 */}
      <div className="grid grid-cols-3 gap-6">
        <div className="flex items-center gap-4 p-4 rounded-lg border">
          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-semibold">{totalStats.total}</p>
            <p className="text-sm text-muted-foreground">总视频数</p>
          </div>
        </div>
        <div className="flex items-center gap-4 p-4 rounded-lg border">
          <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-semibold">{totalStats.analyzed}</p>
            <p className="text-sm text-muted-foreground">已分析</p>
          </div>
        </div>
        <div className="flex items-center gap-4 p-4 rounded-lg border">
          <div className="h-10 w-10 rounded-full bg-yellow-100 flex items-center justify-center">
            <Clock className="h-5 w-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-2xl font-semibold">{totalStats.unanalyzed}</p>
            <p className="text-sm text-muted-foreground">待分析</p>
          </div>
        </div>
      </div>

      {/* Progress Card - 只在运行时显示 */}
      {isRunning && progress && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">正在分析</CardTitle>
                <CardDescription>{progress.message}</CardDescription>
              </div>
              <Button variant="destructive" size="sm" onClick={handleStop}>
                <Square className="h-4 w-4 mr-2" />
                停止
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {progress.currentIndex} / {progress.totalPosts}
              </span>
              <span className="font-medium">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>成功: {progress.analyzedCount}</span>
              <span>失败: {progress.failedCount}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* User Stats List */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">用户分析统计</CardTitle>
              <CardDescription>点击分析按钮开始分析对应用户的视频</CardDescription>
            </div>
            {!isRunning && totalStats.unanalyzed > 0 && (
              <Button onClick={() => handleStart()} size="sm">
                <Play className="h-4 w-4 mr-2" />
                分析全部
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {userStats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">暂无用户数据</p>
              <p className="text-xs mt-1">添加用户并下载视频后可以进行分析</p>
            </div>
          ) : (
            <div className="space-y-2">
              {userStats.map((user) => {
                const isCurrentUser = isRunning && currentSecUid === user.sec_uid
                return (
                  <div
                    key={user.sec_uid}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      isCurrentUser ? 'bg-primary/5 border-primary/30' : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                        {user.nickname.charAt(0)}
                      </div>
                      <span className="font-medium">{user.nickname}</span>
                      {isCurrentUser && (
                        <span className="text-xs text-primary animate-pulse">分析中...</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-green-600">{user.analyzed} 已分析</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-yellow-600">{user.unanalyzed} 待分析</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-muted-foreground">{user.total} 总计</span>
                      </div>
                      {isCurrentUser ? (
                        <Button size="sm" variant="destructive" onClick={handleStop}>
                          <Square className="h-4 w-4 mr-1" />
                          停止
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStart(user.sec_uid)}
                          disabled={isRunning || user.unanalyzed === 0}
                        >
                          <Play className="h-4 w-4 mr-1" />
                          分析
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
