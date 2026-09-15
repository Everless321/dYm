import { Page, PageBody } from '@/components/layout/Page'
import { PageHeader } from '@/components/layout/PageHeader'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Sparkles, ListChecks, SlidersHorizontal, Cpu, Mic } from 'lucide-react'
import type { AiProviderView, AnalysisJobView, AsrProviderView } from '@shared/ai'
import { JobsPanel } from './JobsPanel'
import { SettingsPanel } from './SettingsPanel'
import { ProvidersPanel } from './ProvidersPanel'
import { AsrProvidersPanel } from './AsrProvidersPanel'
import { NewJobDialog } from './NewJobDialog'
import { isJobActive } from './shared'

type Tab = 'queue' | 'settings' | 'providers' | 'asr'

const TABS: { value: Tab; label: string; icon: typeof ListChecks }[] = [
  { value: 'queue', label: '分析队列', icon: ListChecks },
  { value: 'settings', label: '分析设置', icon: SlidersHorizontal },
  { value: 'providers', label: 'AI 提供方', icon: Cpu },
  { value: 'asr', label: '语音转写', icon: Mic }
]

const STATS_REFRESH_MS = 2000

export default function AnalysisPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab =
    tabParam === 'settings' || tabParam === 'providers' || tabParam === 'asr' ? tabParam : 'queue'
  const setTab = (next: Tab): void => {
    const params = new URLSearchParams(searchParams)
    if (next === 'queue') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  const [jobs, setJobs] = useState<AnalysisJobView[] | null>(null)
  const [totals, setTotals] = useState<TotalAnalysisStats | null>(null)
  const [providers, setProviders] = useState<AiProviderView[]>([])
  const [asrProviders, setAsrProviders] = useState<AsrProviderView[]>([])
  const [newJobOpen, setNewJobOpen] = useState(false)

  const refreshTotals = useCallback((): void => {
    window.api.analysis
      .getTotalStats()
      .then(setTotals)
      .catch((error) => console.error('[AnalysisPage] 获取统计失败:', error))
  }, [])

  const loadProviders = useCallback((): void => {
    window.api.ai
      .listProviders()
      .then(setProviders)
      .catch((error) => console.error('[AnalysisPage] 获取提供方失败:', error))
    window.api.asr
      .listProviders()
      .then(setAsrProviders)
      .catch((error) => console.error('[AnalysisPage] 获取转写服务失败:', error))
  }, [])

  useEffect(() => {
    window.api.analysis
      .listJobs()
      .then(setJobs)
      .catch((error) => {
        toast.error(`加载作业列表失败: ${(error as Error).message}`)
        setJobs([])
      })
    refreshTotals()
    loadProviders()
  }, [refreshTotals, loadProviders])

  // 队列推送：作业快照直接替换；有条目完成时节流刷新统计
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const unsub = window.api.analysis.onQueue((event) => {
      setJobs(event.jobs)
      if (event.itemDone && !statsTimer.current) {
        statsTimer.current = setTimeout(() => {
          statsTimer.current = null
          refreshTotals()
        }, STATS_REFRESH_MS)
      }
    })
    return () => {
      unsub()
      if (statsTimer.current) clearTimeout(statsTimer.current)
    }
  }, [refreshTotals])

  const activeCount = jobs?.filter(isJobActive).length ?? 0

  return (
    <Page>
      <PageHeader
        title="AI 视频分析"
        description="结合画面、语音转写和文案理解整条视频，输出总结、章节与结构化标签"
        actions={
          <button
            onClick={() => setNewJobOpen(true)}
            className="h-9 px-4 rounded-lg bg-[#0A84FF] text-white text-sm font-medium flex items-center gap-2 hover:bg-[#0060D5] transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            新建分析
          </button>
        }
      />

      <PageBody>
        <div className="inline-flex h-9 items-center rounded-lg bg-[#F2F2F4] p-1">
          {TABS.map((t) => {
            const Icon = t.icon
            const activeTab = tab === t.value
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={`h-7 px-3 rounded-md text-sm flex items-center gap-1.5 transition-colors ${
                  activeTab
                    ? 'bg-white text-[#1D1D1F] shadow-sm font-medium'
                    : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {t.value === 'queue' && activeCount > 0 && (
                  <span className="ml-0.5 h-4 min-w-4 px-1 rounded-full bg-[#0A84FF] text-white text-[10px] flex items-center justify-center">
                    {activeCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div>
          {tab === 'queue' && (
            <JobsPanel jobs={jobs} totals={totals} onCreate={() => setNewJobOpen(true)} />
          )}
          {/* 设置页常驻挂载：切页签不丢未保存的草稿 */}
          <div className={tab === 'settings' ? '' : 'hidden'}>
            <SettingsPanel />
          </div>
          {tab === 'providers' && <ProvidersPanel onChanged={setProviders} />}
          {tab === 'asr' && <AsrProvidersPanel onChanged={setAsrProviders} />}
        </div>
      </PageBody>

      <NewJobDialog
        open={newJobOpen}
        onOpenChange={setNewJobOpen}
        providers={providers}
        asrProviders={asrProviders}
        onCreated={() => refreshTotals()}
        onNeedProvider={() => {
          setNewJobOpen(false)
          setTab('providers')
        }}
      />
    </Page>
  )
}
