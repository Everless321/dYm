export type PanelProgressKind = 'sync' | 'download'

type Listener = (event: PanelProgressKind, data: object) => void

const listeners = new Set<Listener>()
const downloadProgress = new Map<number, object>()
const syncProgress = new Map<number, object>()

/** 下载 / 同步进度除了推给桌面窗口，也给管理端节点一份。监听失败不能影响下载。 */
export function emitPanelProgress(event: PanelProgressKind, data: object): void {
  const record = data as { taskId?: unknown; userId?: unknown }
  if (event === 'download' && typeof record.taskId === 'number') {
    downloadProgress.set(record.taskId, data)
  }
  if (event === 'sync' && typeof record.userId === 'number') {
    syncProgress.set(record.userId, data)
  }
  for (const listener of listeners) {
    try {
      listener(event, data)
    } catch (error) {
      console.error('[Panel] 进度监听失败:', error)
    }
  }
}

export function takeDownloadProgress(taskId: number): object | null {
  return downloadProgress.get(taskId) ?? null
}

export function takeSyncProgress(userId: number): object | null {
  return syncProgress.get(userId) ?? null
}

export function onPanelProgress(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
