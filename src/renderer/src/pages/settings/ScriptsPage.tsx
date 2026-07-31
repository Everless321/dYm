import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Code2,
  FolderOpen,
  Loader2,
  Play,
  Package,
  FileCode,
  RefreshCw,
  AlertTriangle,
  Terminal,
  Trash2
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** 界面上最多渲染的日志条数（主进程每个脚本另有 1000 条的缓存上限） */
const MAX_VISIBLE_LOGS = 500

function formatTime(time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 按 seq 去重合并两批日志——历史拉取与实时推送可能重叠 */
function mergeLogs(a: ScriptLogEntry[], b: ScriptLogEntry[]): ScriptLogEntry[] {
  const bySeq = new Map<number, ScriptLogEntry>()
  for (const entry of a) bySeq.set(entry.seq, entry)
  for (const entry of b) bySeq.set(entry.seq, entry)
  return [...bySeq.values()].sort((x, y) => x.seq - y.seq).slice(-MAX_VISIBLE_LOGS)
}

export default function ScriptsPage(): React.JSX.Element {
  const [scripts, setScripts] = useState<ScriptDescriptor[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [logs, setLogs] = useState<ScriptLogEntry[]>([])
  const [scriptsDir, setScriptsDir] = useState('')
  const [loading, setLoading] = useState(true)
  const logBoxRef = useRef<HTMLDivElement>(null)

  const loadScripts = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [list, running, dir] = await Promise.all([
        window.api.scripts.list(),
        window.api.scripts.running(),
        window.api.scripts.getDir()
      ])
      setScripts(list)
      setRunningIds(running)
      setScriptsDir(dir)
      setSelectedId((prev) =>
        prev && list.some((s) => s.id === prev) ? prev : (list[0]?.id ?? null)
      )
    } catch (error) {
      toast.error(`加载脚本失败: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadScripts()
  }, [loadScripts])

  // 切换脚本 / 重新进入页面时，从主进程恢复该脚本的历史日志
  useEffect(() => {
    if (!selectedId) {
      setLogs([])
      return
    }
    let cancelled = false
    window.api.scripts
      .getLogs(selectedId)
      .then((history) => {
        if (cancelled) return
        // 拉取期间可能已有实时日志到达，按 seq 合并而不是直接覆盖
        setLogs((prev) =>
          mergeLogs(
            history,
            prev.filter((e) => e.scriptId === selectedId)
          )
        )
      })
      .catch(() => {
        if (!cancelled) setLogs([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // 实时日志：只收当前选中脚本的
  useEffect(() => {
    return window.api.scripts.onLog((entry) => {
      if (entry.scriptId !== selectedId) return
      setLogs((prev) => mergeLogs(prev, [entry]))
    })
  }, [selectedId])

  // 运行状态由主进程推送，页面重新挂载后也能反映真实情况
  useEffect(() => {
    return window.api.scripts.onRunningChange(setRunningIds)
  }, [])

  // 新日志到达时滚到底。直接改 scrollTop——scrollIntoView 在嵌套滚动容器里会滚错层级
  useEffect(() => {
    const box = logBoxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [logs])

  const selected = scripts.find((s) => s.id === selectedId) ?? null
  const isRunning = selected ? runningIds.includes(selected.id) : false

  // 运行状态不在这里维护，由主进程的 onRunningChange 推送，避免切页面后状态失真
  const handleRun = async (): Promise<void> => {
    if (!selected || isRunning) return
    try {
      const result = await window.api.scripts.run(selected.id)
      if (result.ok) {
        toast.success(`「${selected.name}」运行完成（${result.durationMs} ms）`)
      } else {
        toast.error(`「${selected.name}」运行失败: ${result.error}`)
      }
    } catch (error) {
      toast.error(`运行失败: ${(error as Error).message}`)
    }
  }

  const handleClearLogs = async (): Promise<void> => {
    if (!selectedId) return
    await window.api.scripts.clearLogs(selectedId)
    setLogs([])
  }

  const builtinScripts = scripts.filter((s) => s.source === 'builtin')
  const externalScripts = scripts.filter((s) => s.source === 'external')

  const renderGroup = (
    title: string,
    icon: React.ReactNode,
    items: ScriptDescriptor[],
    emptyHint: string
  ): React.JSX.Element => (
    <div>
      <div className="flex items-center gap-2 px-3 pb-1.5">
        {icon}
        <span className="text-[11px] font-medium text-[#A1A1A6] tracking-wide">{title}</span>
        <span className="text-[11px] text-[#C7C7CC] tabular-nums">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-1.5 text-xs text-[#C7C7CC]">{emptyHint}</p>
      ) : (
        <div className="space-y-0.5">
          {items.map((script) => (
            <button
              key={script.id}
              onClick={() => setSelectedId(script.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-lg transition-colors',
                selectedId === script.id ? 'bg-[#E8F0FE]' : 'hover:bg-[#F2F2F4]'
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'text-sm truncate',
                    selectedId === script.id ? 'text-[#0A84FF] font-medium' : 'text-[#1D1D1F]'
                  )}
                >
                  {script.name}
                </span>
                {script.error && (
                  <AlertTriangle className="h-3.5 w-3.5 text-[#FF9500] flex-shrink-0" />
                )}
                {runningIds.includes(script.id) && (
                  <Loader2 className="h-3.5 w-3.5 text-[#0A84FF] animate-spin flex-shrink-0" />
                )}
              </div>
              {script.description && (
                <p className="text-xs text-[#A1A1A6] mt-0.5 line-clamp-1">{script.description}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-[#E5E5E7] bg-white flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-[#1D1D1F]">自定义脚本</h1>
          <p className="text-sm text-[#6E6E73] mt-0.5">运行内置脚本，或把自己的 .js 放进脚本目录</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadScripts}
            disabled={loading}
            className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            重新扫描
          </button>
          <button
            onClick={() => window.api.scripts.openDir()}
            className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-2"
          >
            <FolderOpen className="h-4 w-4" />
            打开脚本目录
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden px-6 py-8">
        <div className="mx-auto max-w-6xl h-full flex gap-6">
          {/* 脚本列表 */}
          <aside className="w-60 flex-shrink-0 bg-white rounded-2xl border border-[#E5E5E7] shadow-sm overflow-y-auto p-3 space-y-6">
            {renderGroup(
              '内置脚本',
              <Package className="h-3.5 w-3.5 text-[#A1A1A6]" />,
              builtinScripts,
              '暂无内置脚本'
            )}
            {renderGroup(
              '我的脚本',
              <FileCode className="h-3.5 w-3.5 text-[#A1A1A6]" />,
              externalScripts,
              '目录里还没有 .js 文件'
            )}
          </aside>

          {/* 详情 + 输出：min-w-0 让长路径/日志在容器内换行而不是撑破布局 */}
          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-[#E5E5E7] shadow-sm flex flex-col overflow-hidden">
            {selected ? (
              <>
                <div className="px-6 py-5 border-b border-[#E5E5E7] flex-shrink-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold text-[#1D1D1F] truncate">
                          {selected.name}
                        </h2>
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#F2F2F4] text-[#6E6E73] flex-shrink-0">
                          {selected.source === 'builtin' ? '内置' : '我的脚本'}
                        </span>
                      </div>
                      <p className="text-sm text-[#6E6E73] mt-1">
                        {selected.description || '（无描述）'}
                      </p>
                      {selected.filePath && (
                        <p className="text-xs text-[#A1A1A6] mt-1.5 font-mono break-all">
                          {selected.filePath}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleRun}
                      disabled={isRunning || !!selected.error}
                      className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors flex items-center gap-2 disabled:opacity-50 flex-shrink-0"
                    >
                      {isRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      {isRunning ? '运行中' : '运行'}
                    </button>
                  </div>

                  {selected.error && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#FFF8ED] border border-[#FF9500]/25 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-[#FF9500] flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-[#8A5A00] whitespace-pre-wrap break-all">
                        {selected.error}
                      </p>
                    </div>
                  )}
                </div>

                {/* 输出面板：无日志时不画框，避免一个巨大的空盒子 */}
                {logs.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center px-6">
                    <p className="text-sm text-[#A1A1A6]">点击「运行」，脚本输出会显示在这里</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-6 pt-4 pb-2 flex-shrink-0">
                      <div className="flex items-center gap-2">
                        <Terminal className="h-3.5 w-3.5 text-[#A1A1A6]" />
                        <span className="text-[11px] font-medium text-[#A1A1A6] tracking-wide">
                          输出
                        </span>
                      </div>
                      <button
                        onClick={handleClearLogs}
                        className="h-7 px-2 rounded-md text-[11px] text-[#A1A1A6] hover:text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-1"
                      >
                        <Trash2 className="h-3 w-3" />
                        清空
                      </button>
                    </div>

                    {/* items-start + max-h-full：框高跟随日志行数，超出可用空间才滚动 */}
                    <div className="flex-1 min-h-0 flex items-start overflow-hidden px-6 pb-6">
                      <div
                        ref={logBoxRef}
                        className="w-full max-h-full overflow-auto rounded-xl bg-[#F5F5F7] border border-[#E5E5E7] px-4 py-3"
                      >
                        <div className="font-mono text-xs leading-[1.7]">
                          {logs.map((entry, index) => (
                            <div
                              key={`${entry.runId}-${index}`}
                              className={cn(
                                'flex gap-2 whitespace-pre-wrap break-all',
                                entry.level === 'error' ? 'text-[#D70015]' : 'text-[#1D1D1F]'
                              )}
                            >
                              <span className="text-[#C7C7CC] select-none flex-shrink-0 tabular-nums">
                                {formatTime(entry.time)}
                              </span>
                              <span className="min-w-0">{entry.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                <div className="h-16 w-16 rounded-full bg-[#F2F2F4] flex items-center justify-center mb-4">
                  <Code2 className="h-8 w-8 text-[#A1A1A6]" />
                </div>
                <p className="text-base font-medium text-[#1D1D1F]">还没有可运行的脚本</p>
                <p className="text-sm text-[#6E6E73] mt-1 max-w-sm">
                  把导出 meta 和 run 的 .js 文件放进脚本目录，再点「重新扫描」
                </p>
                {scriptsDir && (
                  <p className="text-xs text-[#C7C7CC] mt-3 font-mono break-all max-w-md">
                    {scriptsDir}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
