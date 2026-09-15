import { Page, PageBody } from '@/components/layout/Page'
import { PageHeader } from '@/components/layout/PageHeader'
import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Radio,
  Square,
  FolderOpen,
  Trash2,
  RefreshCw,
  CircleDot,
  Play,
  Loader2,
  CheckSquare,
  Check,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { LiveCheckDialog } from '@/components/dialogs/LiveCheckDialog'
import { toast } from 'sonner'
import { formatBytes, formatDuration, formatUnixTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const STATUS_CONFIG: Record<LiveRecord['status'], { label: string; bg: string; text: string }> = {
  recording: { label: '录制中', bg: 'bg-red-50', text: 'text-red-600' },
  completed: { label: '已完成', bg: 'bg-green-50', text: 'text-green-600' },
  stopped: { label: '已停止', bg: 'bg-gray-100', text: 'text-gray-600' },
  failed: { label: '失败', bg: 'bg-amber-50', text: 'text-amber-600' }
}

export default function LiveRecordPage(): React.JSX.Element {
  const [records, setRecords] = useState<LiveRecord[]>([])
  const [recordingUserIds, setRecordingUserIds] = useState<number[]>([])
  const [convertingIds, setConvertingIds] = useState<number[]>([])
  const [checkDialogOpen, setCheckDialogOpen] = useState(false)

  // 多选删除
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // 删除确认：待删的记录列表（单个或批量走同一个对话框）
  const [deleteTargets, setDeleteTargets] = useState<LiveRecord[] | null>(null)
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadRecords = useCallback(async () => {
    try {
      const list = await window.api.live.getRecords()
      setRecords(list)
    } catch (error) {
      toast.error(`加载录制记录失败: ${(error as Error).message}`)
    }
  }, [])

  const loadRecordingIds = useCallback(async () => {
    try {
      const ids = await window.api.live.getRecordingUsers()
      setRecordingUserIds(ids)
    } catch (error) {
      toast.error(`获取录制状态失败: ${(error as Error).message}`)
    }
  }, [])

  const loadConvertingIds = useCallback(async () => {
    try {
      const ids = await window.api.live.getConvertingIds()
      setConvertingIds(ids)
    } catch (error) {
      toast.error(`获取转换状态失败: ${(error as Error).message}`)
    }
  }, [])

  useEffect(() => {
    loadRecords()
    loadRecordingIds()
    loadConvertingIds()
    // 订阅录制进度事件，实时刷新
    const unsubscribe = window.api.live.onProgress((p) => {
      loadRecordingIds()
      loadConvertingIds()
      if (p.status === 'recording') {
        toast.success(`开始录制：${p.nickname}`)
        loadRecords()
      } else if (p.status === 'completed' || p.status === 'stopped') {
        toast.info(`录制结束：${p.nickname}`)
        loadRecords()
      } else if (p.status === 'failed') {
        toast.error(`录制失败：${p.nickname} - ${p.message}`)
        loadRecords()
      } else if (p.status === 'converted') {
        toast.success(`转换完成：${p.nickname}，可以观看了`)
        loadRecords()
      } else if (p.status === 'convert-failed') {
        toast.error(`转换失败：${p.nickname} - ${p.message}`)
        loadRecords()
      } else if (p.status === 'converting') {
        loadRecords()
      }
    })
    return unsubscribe
  }, [loadRecords, loadRecordingIds, loadConvertingIds])

  // 列表刷新后，已消失的记录从选中集合里剔除
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set(records.map((r) => r.id))
      const next = new Set([...prev].filter((id) => alive.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [records])

  const canDelete = useCallback(
    (rec: LiveRecord) => rec.status !== 'recording' && !convertingIds.includes(rec.id),
    [convertingIds]
  )

  const deletableRecords = useMemo(() => records.filter(canDelete), [records, canDelete])

  const handleOpen = (rec: LiveRecord): void => {
    if (rec.status === 'recording') {
      toast.info('录制进行中，结束并转换完成后才能观看')
      return
    }
    if (convertingIds.includes(rec.id)) {
      toast.info('正在转换为可播放格式，转换完成后即可观看')
      return
    }
    if (rec.file_path && !rec.file_path.toLowerCase().endsWith('.mp4')) {
      toast.warning('该录制尚未完成转换，转换完成后才能观看')
      return
    }
    window.api.live.openPlayer(rec.id)
  }

  const handleStop = async (userId: number): Promise<void> => {
    try {
      const stopped = await window.api.live.stop(userId)
      if (stopped) {
        toast.info('正在停止录制，收尾中…')
      } else {
        toast.warning('没有正在进行的录制（状态已刷新）')
      }
    } catch (error) {
      toast.error(`停止录制失败: ${(error as Error).message}`)
    }
    loadRecords()
    loadRecordingIds()
  }

  const toggleSelected = (id: number): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelectMode = (): void => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const openDelete = (targets: LiveRecord[]): void => {
    if (targets.length === 0) return
    setDeleteFiles(false)
    setDeleteTargets(targets)
  }

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteTargets || deleteTargets.length === 0) return
    setDeleting(true)
    try {
      const result = await window.api.live.deleteRecords(
        deleteTargets.map((r) => r.id),
        deleteFiles
      )
      if (result.deleted > 0) {
        const freed =
          deleteFiles && result.freedBytes > 0 ? `，释放约 ${formatBytes(result.freedBytes)}` : ''
        toast.success(`已删除 ${result.deleted} 条录制记录${freed}`)
      }
      if (result.failed.length > 0) {
        const first = result.failed[0].reason
        toast.error(
          result.failed.length === 1
            ? `删除失败：${first}`
            : `${result.failed.length} 条未能删除（${first}）`
        )
      }
      setDeleteTargets(null)
      if (selectMode) exitSelectMode()
    } catch (error) {
      toast.error(`删除失败: ${(error as Error).message}`)
    } finally {
      setDeleting(false)
      loadRecords()
    }
  }

  const deleteTotalBytes = useMemo(
    () => (deleteTargets ?? []).reduce((sum, r) => sum + (r.file_size || 0), 0),
    [deleteTargets]
  )

  const selectedRecords = useMemo(
    () => records.filter((r) => selectedIds.has(r.id)),
    [records, selectedIds]
  )

  return (
    <Page>
      <PageHeader
        title="直播录制"
        meta={
          selectMode
            ? `已选 ${selectedIds.size} / ${deletableRecords.length}`
            : recordingUserIds.length > 0
              ? `${recordingUserIds.length} 路录制中`
              : '空闲'
        }
        actions={
          selectMode ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const allSelected =
                    deletableRecords.length > 0 &&
                    deletableRecords.every((r) => selectedIds.has(r.id))
                  setSelectedIds(
                    allSelected ? new Set() : new Set(deletableRecords.map((r) => r.id))
                  )
                }}
                className="border-[#E5E5E7] text-[#6E6E73]"
              >
                <CheckSquare className="h-4 w-4 mr-2" />
                {deletableRecords.length > 0 && deletableRecords.every((r) => selectedIds.has(r.id))
                  ? '取消全选'
                  : '全选'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={selectedIds.size === 0}
                onClick={() => openDelete(selectedRecords)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                删除选中{selectedIds.size > 0 ? `（${selectedIds.size}）` : ''}
              </Button>
              <Button variant="ghost" size="sm" onClick={exitSelectMode} className="text-[#6E6E73]">
                <X className="h-4 w-4 mr-2" />
                完成
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCheckDialogOpen(true)}
                className="border-[#E5E5E7] text-[#6E6E73]"
              >
                <Radio className="h-4 w-4 mr-2" />
                立即检测
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  loadRecords()
                  loadRecordingIds()
                  loadConvertingIds()
                }}
                className="border-[#E5E5E7] text-[#6E6E73]"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                刷新
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={records.length === 0}
                onClick={() => setSelectMode(true)}
                className="border-[#E5E5E7] text-[#6E6E73]"
              >
                <CheckSquare className="h-4 w-4 mr-2" />
                选择
              </Button>
            </>
          )
        }
      />

      {/* Content - Records Grid */}
      <PageBody width="full">
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-full bg-[#F2F2F4] p-6 mb-4">
              <Radio className="h-12 w-12 text-[#A1A1A6]" />
            </div>
            <h2 className="text-xl font-semibold text-[#1D1D1F] mb-2">暂无录制记录</h2>
            <p className="text-[#6E6E73]">
              在「用户管理」中为用户开启「录制直播」并设置检测计划后，将在这里显示
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
            {records.map((rec) => {
              const sc = STATUS_CONFIG[rec.status]
              const isRecording = rec.status === 'recording'
              const isConverting = convertingIds.includes(rec.id)
              const needsConvert =
                !isRecording && !!rec.file_path && !rec.file_path.toLowerCase().endsWith('.mp4')
              const playable = !isRecording && !needsConvert
              const deletable = canDelete(rec)
              const selected = selectedIds.has(rec.id)
              return (
                <ContextMenu key={rec.id}>
                  <ContextMenuTrigger asChild>
                    <Card
                      className={cn(
                        'overflow-hidden cursor-pointer hover:shadow-md transition-shadow group border-[#E5E5E7] bg-white',
                        selectMode && selected && 'ring-2 ring-[#1D1D1F] border-transparent',
                        selectMode && !deletable && 'opacity-50 cursor-not-allowed'
                      )}
                      onClick={() => {
                        if (selectMode) {
                          if (deletable) toggleSelected(rec.id)
                          return
                        }
                        handleOpen(rec)
                      }}
                    >
                      <div className="aspect-[9/16] bg-[#F2F2F4] relative">
                        {rec.cover_path ? (
                          <img
                            src={`local://file${rec.cover_path}`}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Radio className="h-12 w-12 text-[#A1A1A6]" />
                          </div>
                        )}
                        {/* 状态 / 转换 / 画质徽章 */}
                        <div className="absolute top-2 left-2 right-2 flex items-center gap-1.5 flex-wrap pr-8">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.text}`}
                          >
                            {isRecording && <CircleDot className="h-3 w-3 animate-pulse" />}
                            {sc.label}
                          </span>
                          {needsConvert && (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                                isConverting
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'bg-amber-50 text-amber-600'
                              }`}
                            >
                              {isConverting && <RefreshCw className="h-3 w-3 animate-spin" />}
                              {isConverting ? '转换中' : '未转换'}
                            </span>
                          )}
                          {rec.quality && (
                            <span className="bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                              {rec.quality}
                            </span>
                          )}
                        </div>
                        {/* 选择模式：右上角勾选框 */}
                        {selectMode && (
                          <div
                            className={cn(
                              'absolute top-2 right-2 h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors',
                              selected
                                ? 'bg-[#1D1D1F] border-[#1D1D1F] text-white'
                                : 'bg-white/80 border-white'
                            )}
                          >
                            {selected && <Check className="h-4 w-4" />}
                          </div>
                        )}
                        {/* 非选择模式：悬停显示的快捷操作（删除 / 打开文件夹 / 停止） */}
                        {!selectMode && (
                          <div
                            className="absolute top-2 right-2 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isRecording ? (
                              <button
                                type="button"
                                title="停止录制"
                                className="h-7 w-7 rounded-full bg-black/60 hover:bg-red-600 text-white flex items-center justify-center"
                                onClick={() => handleStop(rec.user_id)}
                              >
                                <Square className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                title={deletable ? '删除' : '转换中，暂不能删除'}
                                disabled={!deletable}
                                className="h-7 w-7 rounded-full bg-black/60 hover:bg-red-600 disabled:hover:bg-black/60 disabled:opacity-50 text-white flex items-center justify-center"
                                onClick={() => openDelete([rec])}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {rec.file_path && (
                              <button
                                type="button"
                                title="在文件夹中显示"
                                className="h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
                                onClick={() => window.api.live.revealFile(rec.file_path!)}
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                        {/* 时长徽章 */}
                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                          {formatDuration(rec.started_at, rec.ended_at)}
                        </div>
                        {/* 悬停播放提示（可播放且非选择模式时才显示播放图标） */}
                        {playable && !selectMode && (
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center pointer-events-none">
                            <Play className="h-12 w-12 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-medium text-[#1D1D1F] truncate">
                          {rec.nickname || rec.sec_uid}
                        </p>
                        <p className="text-xs text-[#6E6E73] line-clamp-2 mt-0.5">
                          {rec.title || '（无标题）'}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-[#A1A1A6]">
                          <span>{formatUnixTime(rec.started_at)}</span>
                          <span>{formatBytes(rec.file_size)}</span>
                        </div>
                        {rec.error && (
                          <p className="text-xs text-red-500 mt-0.5 truncate">{rec.error}</p>
                        )}
                      </div>
                    </Card>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    {playable && (
                      <ContextMenuItem onClick={() => handleOpen(rec)}>
                        <Play className="h-4 w-4 mr-2" />
                        播放
                      </ContextMenuItem>
                    )}
                    {isRecording && (
                      <ContextMenuItem
                        onClick={() => handleStop(rec.user_id)}
                        className="text-red-600"
                      >
                        <Square className="h-4 w-4 mr-2" />
                        停止录制
                      </ContextMenuItem>
                    )}
                    {rec.file_path && (
                      <ContextMenuItem onClick={() => window.api.live.revealFile(rec.file_path!)}>
                        <FolderOpen className="h-4 w-4 mr-2" />
                        在文件夹中显示
                      </ContextMenuItem>
                    )}
                    {!isRecording && (
                      <ContextMenuItem
                        disabled={!deletable}
                        onClick={() => openDelete([rec])}
                        className="text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {deletable ? '删除' : '删除（转换中不可用）'}
                      </ContextMenuItem>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
        )}
      </PageBody>

      <LiveCheckDialog
        open={checkDialogOpen}
        onOpenChange={setCheckDialogOpen}
        onChanged={() => {
          loadRecords()
          loadRecordingIds()
        }}
      />

      {/* 删除确认 */}
      <Dialog
        open={!!deleteTargets}
        onOpenChange={(open) => !open && !deleting && setDeleteTargets(null)}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>删除录制记录</DialogTitle>
            <DialogDescription>
              {deleteTargets && deleteTargets.length === 1 ? (
                <>
                  确定要删除{' '}
                  <span className="font-medium text-[#1D1D1F]">
                    {deleteTargets[0].nickname || deleteTargets[0].sec_uid}
                  </span>{' '}
                  于 {formatUnixTime(deleteTargets[0].started_at)} 的这场录制吗？
                </>
              ) : (
                <>
                  确定要删除选中的{' '}
                  <span className="font-medium text-[#1D1D1F]">{deleteTargets?.length ?? 0}</span>{' '}
                  条录制记录吗？
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <label className="flex items-center gap-3 p-3 rounded-lg border border-[#E5E5E7] hover:bg-[#F2F2F4] cursor-pointer transition-colors">
              <Checkbox
                checked={deleteFiles}
                onCheckedChange={(checked) => setDeleteFiles(!!checked)}
                disabled={deleting}
              />
              <div>
                <p className="text-sm font-medium text-[#1D1D1F]">同时删除录制文件</p>
                <p className="text-xs text-[#A1A1A6] mt-0.5">
                  连同视频、弹幕和封面一起从磁盘删除
                  {deleteTotalBytes > 0 ? `，约 ${formatBytes(deleteTotalBytes)}` : ''}
                </p>
              </div>
            </label>
            <p className="text-xs mt-2 px-1 text-[#A1A1A6]">
              {deleteFiles
                ? '此操作不可撤销，文件将被永久删除'
                : '不勾选则只移除列表记录，磁盘上的文件会保留'}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargets(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
