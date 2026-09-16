import type {
  AiProtocol,
  AnalysisJobItemStatus,
  AnalysisJobStatus,
  AnalysisJobView
} from '@shared/ai'
import { AI_PROTOCOLS } from '@shared/ai'

export const JOB_STATUS_META: Record<
  AnalysisJobStatus,
  { label: string; color: string; bg: string }
> = {
  queued: { label: '排队中', color: '#6E6E73', bg: '#F2F2F4' },
  running: { label: '运行中', color: '#0A84FF', bg: '#E8F0FE' },
  paused: { label: '已暂停', color: '#F59E0B', bg: '#FEF3C7' },
  completed: { label: '已完成', color: '#22C55E', bg: '#DCFCE7' },
  failed: { label: '失败', color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: '已取消', color: '#A1A1A6', bg: '#F2F2F4' }
}

export const ITEM_STATUS_META: Record<AnalysisJobItemStatus, { label: string; color: string }> = {
  pending: { label: '等待', color: '#A1A1A6' },
  running: { label: '分析中', color: '#0A84FF' },
  done: { label: '成功', color: '#22C55E' },
  failed: { label: '失败', color: '#EF4444' },
  skipped: { label: '跳过', color: '#A1A1A6' }
}

export function protocolLabel(protocol: AiProtocol): string {
  return AI_PROTOCOLS.find((p) => p.value === protocol)?.label ?? protocol
}

export function isJobActive(job: AnalysisJobView): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'paused'
}

export function jobProgress(job: AnalysisJobView): number {
  if (!job.total) return 0
  return Math.round(((job.done + job.failed + job.skipped) / job.total) * 100)
}

/** 分析队列页的路径；tab 用 query 传，方便别处深链到「提供方」 */
export function analysisPath(tab?: 'queue' | 'settings' | 'providers' | 'asr'): string {
  return tab && tab !== 'queue' ? `/analysis?tab=${tab}` : '/analysis'
}
