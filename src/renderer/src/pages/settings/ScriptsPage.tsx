import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Code2,
  FolderOpen,
  Loader2,
  Play,
  Plus,
  Package,
  FileCode,
  FilePlus2,
  Pencil,
  RefreshCw,
  AlertTriangle,
  CalendarClock,
  Save,
  Square,
  Terminal,
  Trash2
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import CodeEditor from '@/components/CodeEditor'
import { cn } from '@/lib/utils'
import { ScriptNameDialog } from './ScriptNameDialog'
import { ScriptScheduleDialog } from './ScriptScheduleDialog'

/** 界面上最多渲染的日志条数（主进程每个脚本另有 1000 条的缓存上限） */
const MAX_VISIBLE_LOGS = 500

/** 一个脚本的磁盘内容与编辑中的内容，两者不同即为未保存 */
interface SourceEntry {
  saved: string
  draft: string
}

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

/** 定时计划的下次执行时间，展示到分钟即可 */
function formatNextRun(time: number | null): string {
  if (!time) return '—'
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isDirty(entry: SourceEntry | undefined): boolean {
  return !!entry && entry.saved !== entry.draft
}

export default function ScriptsPage(): React.JSX.Element {
  const [scripts, setScripts] = useState<ScriptDescriptor[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [logs, setLogs] = useState<ScriptLogEntry[]>([])
  const [scriptsDir, setScriptsDir] = useState('')
  const [loading, setLoading] = useState(true)
  const [stopping, setStopping] = useState(false)
  const [tab, setTab] = useState<'code' | 'output'>('code')
  const [sources, setSources] = useState<Record<string, SourceEntry>>({})
  const [saving, setSaving] = useState(false)
  /** 新建弹窗要写入的初始内容：null 表示用主进程的起手模板 */
  const [pendingSource, setPendingSource] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  /** 按脚本 id 索引的定时计划，没设过的脚本不在表里 */
  const [schedules, setSchedules] = useState<Record<string, ScriptScheduleInfo>>({})
  const logBoxRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (preferId?: string): Promise<void> => {
    setLoading(true)
    try {
      const [list, running, dir, scheduleList] = await Promise.all([
        window.api.scripts.list(),
        window.api.scripts.running(),
        window.api.scripts.getDir(),
        window.api.scripts.getSchedules()
      ])
      setScripts(list)
      setRunningIds(running)
      setScriptsDir(dir)
      setSchedules(Object.fromEntries(scheduleList.map((item) => [item.scriptId, item])))
      setSelectedId((prev) => {
        const wanted = preferId ?? prev
        return wanted && list.some((s) => s.id === wanted) ? wanted : (list[0]?.id ?? null)
      })
      // 已保存的缓存丢掉，重新从磁盘读；未保存的草稿留着，别让「重新扫描」吃掉编辑内容
      setSources((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([, entry]) => isDirty(entry)))
      )
    } catch (error) {
      toast.error(`加载脚本失败: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 首次选中某个脚本时读取源码，之后一直用内存里的副本，避免覆盖未保存的编辑
  useEffect(() => {
    if (!selectedId || sources[selectedId]) return
    const id = selectedId
    let cancelled = false
    window.api.scripts
      .read(id)
      .then((text) => {
        if (cancelled) return
        setSources((prev) => (prev[id] ? prev : { ...prev, [id]: { saved: text, draft: text } }))
      })
      .catch((error) => {
        if (!cancelled) toast.error(`读取脚本内容失败: ${(error as Error).message}`)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, sources])

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
    // 输出面板没显示时不必滚
  }, [logs, tab])

  const selected = scripts.find((s) => s.id === selectedId) ?? null
  const selectedSchedule = selectedId ? schedules[selectedId] : undefined
  const isRunning = selected ? runningIds.includes(selected.id) : false
  const entry = selectedId ? sources[selectedId] : undefined
  const dirty = isDirty(entry)
  const editable = selected?.source === 'external'

  const handleDraftChange = useCallback(
    (value: string): void => {
      if (!selectedId) return
      setSources((prev) => {
        const current = prev[selectedId]
        if (!current || current.draft === value) return prev
        return { ...prev, [selectedId]: { ...current, draft: value } }
      })
    },
    [selectedId]
  )

  /** 保存当前草稿，返回是否成功 */
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!selected?.fileName || !entry || !dirty) return true
    const { fileName, id } = selected
    const content = entry.draft
    setSaving(true)
    try {
      const descriptor = await window.api.scripts.save(fileName, content)
      // 保存期间用户可能又敲了字，草稿以最新的为准
      setSources((prev) => ({
        ...prev,
        [id]: { saved: content, draft: prev[id]?.draft ?? content }
      }))
      setScripts((prev) => prev.map((s) => (s.id === descriptor.id ? descriptor : s)))
      if (descriptor.error) {
        toast.warning(`已保存，但脚本无法加载：${descriptor.error}`)
      } else {
        toast.success('已保存')
      }
      return true
    } catch (error) {
      toast.error(`保存失败: ${(error as Error).message}`)
      return false
    } finally {
      setSaving(false)
    }
  }, [selected, entry, dirty])

  // 运行前先落盘：跑的是磁盘上的文件，不先保存就会跑到旧代码
  const handleRun = async (): Promise<void> => {
    if (!selected || isRunning) return
    if (dirty && !(await handleSave())) return
    setTab('output')
    try {
      const result = await window.api.scripts.run(selected.id)
      if (result.ok) {
        toast.success(`「${selected.name}」运行完成（${result.durationMs} ms）`)
      } else if (result.cancelled) {
        toast.info(`「${selected.name}」${result.error}`)
      } else {
        toast.error(`「${selected.name}」运行失败: ${result.error}`)
      }
    } catch (error) {
      toast.error(`运行失败: ${(error as Error).message}`)
    }
  }

  const handleStop = async (): Promise<void> => {
    if (!selected) return
    setStopping(true)
    try {
      await window.api.scripts.stop(selected.id)
    } finally {
      setStopping(false)
    }
  }

  const handleClearLogs = async (): Promise<void> => {
    if (!selectedId) return
    await window.api.scripts.clearLogs(selectedId)
    setLogs([])
  }

  const handleCreate = async (fileName: string): Promise<void> => {
    const source =
      pendingSource ?? (await window.api.scripts.template(fileName.replace(/\.js$/, '')))
    const descriptor = await window.api.scripts.create(fileName, source)
    await refresh(descriptor.id)
    setTab('code')
    toast.success(`已创建 ${fileName}`)
  }

  const handleRename = async (fileName: string): Promise<void> => {
    if (!selected?.fileName) return
    const oldId = selected.id
    const descriptor = await window.api.scripts.rename(selected.fileName, fileName)
    // 草稿跟着改名走，否则重命名后编辑内容会凭空消失
    setSources((prev) => {
      const moved = { ...prev }
      const current = moved[oldId]
      delete moved[oldId]
      if (current) moved[descriptor.id] = current
      return moved
    })
    await refresh(descriptor.id)
    toast.success(`已重命名为 ${fileName}`)
  }

  const handleDelete = async (): Promise<void> => {
    if (!selected?.fileName) return
    const { fileName, id, name } = selected
    try {
      await window.api.scripts.delete(fileName)
      setSources((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setDeleteOpen(false)
      await refresh()
      toast.success(`已删除「${name}」`)
    } catch (error) {
      toast.error(`删除失败: ${(error as Error).message}`)
    }
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
                {isDirty(sources[script.id]) && (
                  <span
                    title="有未保存的修改"
                    className="h-1.5 w-1.5 rounded-full bg-[#FF9500] flex-shrink-0"
                  />
                )}
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
          <p className="text-sm text-[#6E6E73] mt-0.5">在这里直接写脚本，或把 .js 放进脚本目录</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setPendingSource(null)
              setCreateOpen(true)
            }}
            className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            新建脚本
          </button>
          <button
            onClick={() => refresh()}
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
        <div className="mx-auto max-w-7xl h-full flex gap-6">
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
              '还没有脚本，点右上角「新建脚本」'
            )}
          </aside>

          {/* 详情 + 编辑器/输出：min-w-0 让长路径/日志在容器内换行而不是撑破布局 */}
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
                          {selected.source === 'builtin' ? '内置 · 只读' : '我的脚本'}
                        </span>
                        {dirty && (
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#FFF8ED] text-[#8A5A00] flex-shrink-0">
                            未保存
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-[#6E6E73] mt-1">
                        {selected.description || '（无描述）'}
                      </p>
                      {selectedSchedule?.enabled && (
                        <p className="text-xs text-[#0A84FF] mt-1.5 flex items-center gap-1.5">
                          <CalendarClock className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="font-mono">{selectedSchedule.cron}</span>
                          <span className="text-[#A1A1A6]">
                            下次 {formatNextRun(selectedSchedule.nextRun)}
                          </span>
                        </p>
                      )}
                      {selected.filePath && (
                        <p className="text-xs text-[#A1A1A6] mt-1.5 font-mono break-all">
                          {selected.filePath}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setScheduleOpen(true)}
                        title={
                          selectedSchedule?.enabled
                            ? `定时执行：${selectedSchedule.cron}`
                            : '设置定时执行'
                        }
                        className={cn(
                          'h-9 w-9 rounded-lg border transition-colors flex items-center justify-center',
                          selectedSchedule?.enabled
                            ? 'border-[#0A84FF] bg-[#E8F0FE] text-[#0A84FF]'
                            : 'border-[#E5E5E7] text-[#6E6E73] hover:bg-[#F2F2F4]'
                        )}
                      >
                        <CalendarClock className="h-4 w-4" />
                      </button>
                      {editable && (
                        <>
                          <button
                            onClick={() => setRenameOpen(true)}
                            title="重命名"
                            className="h-9 w-9 rounded-lg border border-[#E5E5E7] text-[#6E6E73] hover:bg-[#F2F2F4] transition-colors flex items-center justify-center"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteOpen(true)}
                            title="删除"
                            className="h-9 w-9 rounded-lg border border-[#E5E5E7] text-[#6E6E73] hover:bg-[#FFF1F0] hover:text-[#FF3B30] transition-colors flex items-center justify-center"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {isRunning ? (
                        <button
                          onClick={handleStop}
                          disabled={stopping}
                          className="h-9 px-4 rounded-lg bg-[#FF3B30] text-sm text-white font-medium hover:bg-[#D70015] transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          {stopping ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Square className="h-4 w-4 fill-current" />
                          )}
                          {stopping ? '停止中' : '停止'}
                        </button>
                      ) : (
                        <button
                          onClick={handleRun}
                          disabled={!!selected.error || saving}
                          title={dirty ? '会先保存再运行' : undefined}
                          className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          <Play className="h-4 w-4" />
                          运行
                        </button>
                      )}
                    </div>
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

                {/* 代码 / 输出 切换 */}
                <div className="flex items-center gap-1 px-6 pt-3 flex-shrink-0">
                  {(
                    [
                      { key: 'code', label: '代码', icon: <Code2 className="h-3.5 w-3.5" /> },
                      {
                        key: 'output',
                        label: logs.length > 0 ? `输出 · ${logs.length}` : '输出',
                        icon: <Terminal className="h-3.5 w-3.5" />
                      }
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.key}
                      onClick={() => setTab(item.key)}
                      className={cn(
                        'h-8 px-3 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5',
                        tab === item.key
                          ? 'bg-[#E8F0FE] text-[#0A84FF]'
                          : 'text-[#6E6E73] hover:bg-[#F2F2F4]'
                      )}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>

                {tab === 'code' ? (
                  <>
                    <div className="flex-1 min-h-0 px-6 pt-3">
                      <div className="h-full rounded-xl border border-[#E5E5E7] overflow-hidden">
                        {entry ? (
                          <CodeEditor
                            key={selected.id}
                            value={entry.draft}
                            onChange={handleDraftChange}
                            onSave={handleSave}
                            readOnly={!editable}
                          />
                        ) : (
                          <div className="h-full flex items-center justify-center bg-[#F5F5F7]">
                            <Loader2 className="h-4 w-4 animate-spin text-[#A1A1A6]" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between px-6 py-3 flex-shrink-0">
                      {editable ? (
                        <>
                          <span className="text-[11px] text-[#A1A1A6]">
                            {dirty ? '有未保存的修改 · ⌘/Ctrl+S 保存' : '已保存'}
                          </span>
                          <button
                            onClick={handleSave}
                            disabled={!dirty || saving}
                            className="h-8 px-3 rounded-lg bg-[#0A84FF] text-xs text-white font-medium hover:bg-[#0060D5] transition-colors flex items-center gap-1.5 disabled:opacity-40"
                          >
                            {saving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Save className="h-3.5 w-3.5" />
                            )}
                            保存
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-[11px] text-[#A1A1A6]">
                            内置脚本随版本更新，不可编辑——复制一份就能改
                          </span>
                          <button
                            onClick={() => {
                              setPendingSource(entry?.draft ?? '')
                              setCreateOpen(true)
                            }}
                            disabled={!entry}
                            className="h-8 px-3 rounded-lg border border-[#E5E5E7] text-xs text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-1.5 disabled:opacity-40"
                          >
                            <FilePlus2 className="h-3.5 w-3.5" />
                            以此为模板新建
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : logs.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center px-6">
                    <p className="text-sm text-[#A1A1A6]">点击「运行」，脚本输出会显示在这里</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-end px-6 pt-2 pb-1 flex-shrink-0">
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
                          {logs.map((log, index) => (
                            <div
                              key={`${log.runId}-${index}`}
                              className={cn(
                                'flex gap-2 whitespace-pre-wrap break-all',
                                log.level === 'error' ? 'text-[#D70015]' : 'text-[#1D1D1F]'
                              )}
                            >
                              <span className="text-[#C7C7CC] select-none flex-shrink-0 tabular-nums">
                                {formatTime(log.time)}
                              </span>
                              <span className="min-w-0">{log.message}</span>
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
                  点右上角「新建脚本」直接在这里写，或把 .js 放进脚本目录后「重新扫描」
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

      <ScriptNameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={pendingSource === null ? '新建脚本' : '复制为我的脚本'}
        description={
          pendingSource === null
            ? '会在脚本目录创建一个带起手模板的 .js 文件'
            : '会把当前脚本的内容复制成一份可编辑的 .js 文件'
        }
        confirmLabel="创建"
        onConfirm={handleCreate}
      />

      <ScriptNameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="重命名脚本"
        description="只改文件名，脚本里 meta.name 显示的名称需要自己在代码里改"
        confirmLabel="重命名"
        initialFileName={selected?.fileName ?? ''}
        onConfirm={handleRename}
      />

      {selected && (
        <ScriptScheduleDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          scriptId={selected.id}
          scriptName={selected.name}
          schedule={selectedSchedule ?? null}
          onSaved={(info) =>
            setSchedules((prev) => {
              const next = { ...prev }
              if (info) next[info.scriptId] = info
              else delete next[selected.id]
              return next
            })
          }
        />
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除脚本</DialogTitle>
            <DialogDescription>将删除文件 {selected?.fileName}，此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
