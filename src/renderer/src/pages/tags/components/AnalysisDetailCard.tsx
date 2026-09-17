import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, ListVideo, Star, Info } from 'lucide-react'
import type { PostAnalysisDetail, VideoAnalysis } from '@shared/analysis'

interface AnalysisDetailCardProps {
  postId: number
  /** 变化时重新拉取（重新分析完成后父级 bump 一下） */
  refreshKey: number
  /** 旧版（v1）分析只有一句总结，没有结构化结果时退化显示它 */
  fallbackSummary?: string | null
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—'
  if (sec < 60) return `${Math.round(sec)} 秒`
  const m = Math.floor(sec / 60)
  const r = Math.round(sec % 60)
  if (m < 60) return r ? `${m} 分 ${r} 秒` : `${m} 分`
  const h = Math.floor(m / 60)
  return `${h} 小时 ${m % 60} 分`
}

function nonEmpty(list: string[] | undefined): string[] {
  return (list ?? []).filter((x) => typeof x === 'string' && x.trim())
}

/**
 * 作品编辑页里的「AI 理解」卡片：总结、分类、评分、章节、字幕。
 * 只在 v2 结构化结果存在时渲染；旧版只有标签的作品显示为空态。
 */
export function AnalysisDetailCard({
  postId,
  refreshKey,
  fallbackSummary
}: AnalysisDetailCardProps): React.JSX.Element | null {
  // 结果带上请求 key：key 不匹配就是还没加载完，避免切换作品时闪一下旧数据
  const key = `${postId}:${refreshKey}`
  const [result, setResult] = useState<{ key: string; detail: PostAnalysisDetail | null } | null>(
    null
  )
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.analysis
      .getDetail(postId)
      .then((d) => {
        if (!cancelled) setResult({ key, detail: d })
      })
      .catch((error) => {
        console.error('[AnalysisDetailCard] 获取分析详情失败:', error)
        if (!cancelled) setResult({ key, detail: null })
      })
    return () => {
      cancelled = true
    }
  }, [postId, key])

  if (result?.key !== key) return null
  const detail = result.detail
  const analysis = detail?.analysis
  if (!analysis) {
    if (!fallbackSummary?.trim()) return null
    return (
      <div className="rounded-xl border border-[#E5E5E7] bg-white p-5 space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[#0A84FF]" />
          <span className="text-sm font-medium text-[#1D1D1F]">AI 理解</span>
          <span className="text-[11px] text-[#A1A1A6]">旧版结果 · 重新分析可获得章节与字幕</span>
        </div>
        <p className="text-sm text-[#1D1D1F] leading-relaxed">{fallbackSummary}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#E5E5E7] bg-white p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[#0A84FF]" />
          <span className="text-sm font-medium text-[#1D1D1F]">AI 理解</span>
        </div>
        {detail?.meta && (
          <span className="text-[11px] text-[#A1A1A6] truncate">
            {detail.meta.model}
            {detail.meta.asrEngine ? ` · 转写 ${detail.meta.asrEngine}` : ''}
            {detail.meta.duration > 0
              ? ` · ${fmtDuration(detail.meta.duration)}${
                  detail.meta.analyzedSeconds < detail.meta.duration - 1
                    ? `（分析了 ${fmtDuration(detail.meta.analyzedSeconds)}）`
                    : ''
                }`
              : ''}
          </span>
        )}
      </div>

      {detail?.meta?.asrError && (
        <p className="text-[11px] text-[#B45309] bg-[#FFFBEB] rounded-md px-2.5 py-1.5">
          语音转写未完全成功，本次以画面为主：{detail.meta.asrError}
        </p>
      )}

      <Overview analysis={analysis} />

      {analysis.chapters.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#6E6E73]">
            <ListVideo className="h-3.5 w-3.5" />
            章节（{analysis.chapters.length}）
          </div>
          <ol className="space-y-1.5">
            {analysis.chapters.map((c, i) => (
              <li key={i} className="flex gap-3 text-xs">
                <span className="shrink-0 w-24 font-mono text-[#A1A1A6] tabular-nums">
                  {fmtTime(c.start)}–{fmtTime(c.end)}
                </span>
                <div className="min-w-0">
                  <p className="text-[#1D1D1F] font-medium">{c.title || '未命名段落'}</p>
                  {c.summary && <p className="text-[#6E6E73] mt-0.5">{c.summary}</p>}
                  {c.tags.length > 0 && (
                    <p className="text-[#A1A1A6] mt-0.5 truncate">{c.tags.join(' · ')}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {detail?.transcript && detail.transcript.text.trim() && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-[#6E6E73] hover:text-[#1D1D1F] transition-colors"
          >
            {transcriptOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            字幕
            <span className="text-[#A1A1A6] font-normal">
              {detail.transcript.segments.length} 段
              {detail.transcript.language ? ` · ${detail.transcript.language}` : ''}
              {detail.transcript.partial ? ' · 只转写了抽样片段' : ''}
            </span>
          </button>
          {transcriptOpen && (
            <div className="max-h-72 overflow-y-auto rounded-lg bg-[#F5F5F7] p-3 space-y-1">
              {detail.transcript.segments.length > 0 ? (
                detail.transcript.segments.map((seg, i) => (
                  <div key={i} className="flex gap-3 text-xs leading-relaxed">
                    <span className="shrink-0 w-12 font-mono text-[#A1A1A6] tabular-nums">
                      {fmtTime(seg.start)}
                    </span>
                    <span className="text-[#1D1D1F]">{seg.text}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-[#1D1D1F] leading-relaxed whitespace-pre-wrap">
                  {detail.transcript.text}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Overview({ analysis }: { analysis: VideoAnalysis }): React.JSX.Element {
  const facts: { label: string; value: string }[] = []
  const category = [analysis.category.primary, analysis.category.secondary].filter(Boolean)
  if (category.length) facts.push({ label: '分类', value: category.join(' / ') })
  const setting = [analysis.setting.location, analysis.setting.place, analysis.setting.timeOfDay]
    .filter(Boolean)
    .join(' · ')
  if (setting) facts.push({ label: '场景', value: setting })
  const subjects = [
    analysis.subjects.peopleCount,
    ...nonEmpty(analysis.subjects.appearance),
    ...nonEmpty(analysis.subjects.outfit)
  ].filter(Boolean)
  if (subjects.length) facts.push({ label: '人物', value: subjects.join(' · ') })
  const actions = nonEmpty(analysis.actions)
  if (actions.length) facts.push({ label: '动作', value: actions.join(' · ') })
  const style = nonEmpty(analysis.style)
  if (style.length) facts.push({ label: '风格', value: style.join(' · ') })
  const speech = nonEmpty(analysis.speechTopics)
  if (speech.length) facts.push({ label: '口播', value: speech.join(' · ') })
  const text = nonEmpty(analysis.onScreenText)
  if (text.length) facts.push({ label: '画面文字', value: text.join(' / ') })

  const flags: string[] = []
  if (analysis.flags.isAd) flags.push('广告')
  if (analysis.flags.isRepost) flags.push('搬运')
  if (analysis.flags.hasWatermark) flags.push('有水印')
  if (analysis.flags.noSpeech) flags.push('无口播')

  const dims = Object.entries(analysis.rating.dimensions ?? {}).filter(
    ([, v]) => typeof v === 'number' && Number.isFinite(v)
  )

  return (
    <div className="space-y-3">
      {analysis.summary && (
        <p className="text-sm font-medium text-[#1D1D1F] leading-relaxed">{analysis.summary}</p>
      )}
      {analysis.content && (
        <div className="space-y-1.5">
          {analysis.content
            .split(/\n+/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p, i) => (
              <p key={i} className="text-[13px] text-[#3A3A3C] leading-relaxed">
                {p}
              </p>
            ))}
        </div>
      )}

      {(analysis.rating.level > 0 || flags.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {analysis.rating.level > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#FEF3C7] text-[#B45309] font-medium">
              <Star className="h-3 w-3" />
              {analysis.rating.level}/10
            </span>
          )}
          {dims.map(([k, v]) => (
            <span key={k} className="px-2 py-1 rounded-md bg-[#F5F5F7] text-[#6E6E73]">
              {k} {v}
            </span>
          ))}
          {flags.map((f) => (
            <span key={f} className="px-2 py-1 rounded-md bg-[#FEE2E2] text-[#B91C1C]">
              {f}
            </span>
          ))}
        </div>
      )}

      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          {facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-[#A1A1A6] whitespace-nowrap">{f.label}</dt>
              <dd className="text-[#1D1D1F] min-w-0 break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {analysis.rating.reasons.length > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] text-[#A1A1A6]">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{analysis.rating.reasons.join('；')}</span>
        </div>
      )}
    </div>
  )
}
