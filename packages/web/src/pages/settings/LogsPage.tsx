import { useState, useEffect } from 'react'
import { AlertCircle, Info, AlertTriangle, Trash2, Clock, User, ListTodo } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { schedulerApi } from '@/api/client'
import { useWsChannel } from '@/hooks/useWebSocket'
import type { SchedulerLog } from '@dym/shared'

type LogFilter = 'all' | 'user' | 'task' | 'system'

export default function LogsPage() {
  const [logs, setLogs] = useState<SchedulerLog[]>([])
  const [filter, setFilter] = useState<LogFilter>('all')

  useEffect(() => {
    schedulerApi.getLogs().then(setLogs)
  }, [])

  useWsChannel('scheduler:log', (log: SchedulerLog) => {
    setLogs((prev) => [log, ...prev].slice(0, 500))
  })

  const filteredLogs = filter === 'all' ? logs : logs.filter((log) => log.type === filter)

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const getLevelIcon = (level: SchedulerLog['level']) => {
    switch (level) {
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
      case 'warn':
        return <AlertTriangle className="h-4 w-4 text-amber-500" />
      default:
        return <Info className="h-4 w-4 text-blue-500" />
    }
  }

  const getTypeIcon = (type: SchedulerLog['type']) => {
    switch (type) {
      case 'user':
        return <User className="h-3.5 w-3.5" />
      case 'task':
        return <ListTodo className="h-3.5 w-3.5" />
      default:
        return <Clock className="h-3.5 w-3.5" />
    }
  }

  const getTypeBadge = (type: SchedulerLog['type']) => {
    const config = {
      user: { label: '用户同步', bg: 'bg-blue-50', text: 'text-blue-600' },
      task: { label: '任务下载', bg: 'bg-purple-50', text: 'text-purple-600' },
      system: { label: '系统', bg: 'bg-gray-100', text: 'text-gray-600' }
    }
    const c = config[type]
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}
      >
        {getTypeIcon(type)}
        {c.label}
      </span>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-[#E5E5E7] bg-white">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-[#1D1D1F]">自动同步日志</h1>
          <span className="text-sm text-[#A1A1A6]">({filteredLogs.length})</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await schedulerApi.clearLogs()
            setLogs([])
          }}
          disabled={logs.length === 0}
          className="border-[#E5E5E7] text-[#6E6E73]"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          清空日志
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden px-6 py-8">
        <div className="mx-auto max-w-6xl h-full">
          <div className="h-full bg-white rounded-2xl border border-[#E5E5E7] shadow-sm flex flex-col overflow-hidden">
            {/* Filter Tabs */}
            <div className="h-12 flex items-center gap-2 px-5 border-b border-[#E5E5E7]">
              {[
                { key: 'all', label: '全部' },
                { key: 'user', label: '用户同步' },
                { key: 'task', label: '任务下载' },
                { key: 'system', label: '系统' }
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setFilter(item.key as LogFilter)}
                  className={`h-9 px-4 rounded-full text-sm transition-colors ${
                    filter === item.key
                      ? 'bg-[#E8F0FE] text-[#0A84FF] font-medium'
                      : 'text-[#6E6E73] hover:bg-[#F2F2F4]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Logs List */}
            <div className="flex-1 overflow-auto">
              {filteredLogs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="h-16 w-16 rounded-full bg-[#F2F2F4] flex items-center justify-center mb-4">
                    <Clock className="h-8 w-8 text-[#A1A1A6]" />
                  </div>
                  <p className="text-base font-medium text-[#1D1D1F]">暂无日志</p>
                  <p className="text-sm text-[#6E6E73] mt-1">
                    启用自动同步后，执行日志将显示在这里
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#E5E5E7]">
                  {filteredLogs.map((log, index) => (
                    <div
                      key={`${log.timestamp}-${index}`}
                      className="flex items-start gap-4 px-5 py-3 hover:bg-[#F2F2F4]/50 transition-colors"
                    >
                      <div className="flex-shrink-0 mt-0.5">{getLevelIcon(log.level)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-[#1D1D1F]">{log.message}</span>
                          {log.targetName && (
                            <span className="text-xs text-[#6E6E73] bg-[#F2F2F4] px-2 py-0.5 rounded font-medium">
                              {log.targetName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-[#A1A1A6]">
                            {formatTime(log.timestamp)}
                          </span>
                          {getTypeBadge(log.type)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
