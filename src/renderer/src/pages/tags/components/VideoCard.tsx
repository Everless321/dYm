import { Play, Tag, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getMergedTags, parseTags } from '@/lib/utils'

interface VideoCardProps {
  post: DbPost
  cover?: string
  selectMode: boolean
  selected: boolean
  /** 高亮显示的标签（当前按标签筛选时） */
  highlightTags?: string[]
  onClick: () => void
  onToggleSelect: () => void
}

const MAX_VISIBLE_TAGS = 3

export function VideoCard({
  post,
  cover,
  selectMode,
  selected,
  highlightTags,
  onClick,
  onToggleSelect
}: VideoCardProps): React.JSX.Element {
  const tags = getMergedTags(post)
  const manualSet = new Set(parseTags(post.manual_tags))
  const hl = new Set(highlightTags || [])
  // 命中筛选的标签排到前面，保证在只显示 3 个时不被截掉
  const ordered = hl.size ? [...tags].sort((a, b) => Number(hl.has(b)) - Number(hl.has(a))) : tags

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden bg-white transition-all hover:shadow-md',
        selected ? 'border-[#0A84FF] ring-2 ring-[#0A84FF]/30' : 'border-[#E5E5E7]'
      )}
    >
      <div className="relative aspect-[3/4] bg-[#1D1D1F] cursor-pointer" onClick={onClick}>
        {cover ? (
          <img src={`local://file${cover}`} className="w-full h-full object-cover" alt="" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Play className="h-8 w-8 text-white/40" />
          </div>
        )}
        {post.analysis_content_level !== null && (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm tabular-nums">
            {post.analysis_content_level}
          </span>
        )}
        {selectMode && (
          <>
            {/* 顶部渐变让勾选框在浅色封面上依然清晰 */}
            {!selected && (
              <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/30 to-transparent pointer-events-none" />
            )}
            {selected && <div className="absolute inset-0 bg-[#0A84FF]/15 pointer-events-none" />}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelect()
              }}
              className={cn(
                'absolute top-2.5 left-2.5 z-10 h-6 w-6 rounded-full flex items-center justify-center border transition-all',
                selected
                  ? 'bg-[#0A84FF] border-[#0A84FF] shadow'
                  : 'bg-black/25 border-white/90 backdrop-blur-sm hover:bg-black/40'
              )}
              aria-label="选择"
            >
              {selected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
            </button>
          </>
        )}
      </div>
      <div className="p-3.5 space-y-2">
        <p className="text-xs text-[#1D1D1F] truncate leading-relaxed">
          {post.desc || post.caption || '无描述'}
        </p>
        <div className="flex flex-wrap gap-1.5 min-h-[20px]">
          {ordered.slice(0, MAX_VISIBLE_TAGS).map((t) => (
            <span
              key={t}
              className={cn(
                'inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full',
                hl.has(t)
                  ? 'bg-[#0A84FF] text-white'
                  : manualSet.has(t)
                    ? 'bg-[#E8F8EE] text-[#248A3D]'
                    : 'bg-[#F2F2F4] text-[#6E6E73]'
              )}
            >
              <Tag className="h-2.5 w-2.5" />
              {t}
            </span>
          ))}
          {ordered.length > MAX_VISIBLE_TAGS && (
            <span className="text-[10px] text-[#A1A1A6] self-center">
              +{ordered.length - MAX_VISIBLE_TAGS}
            </span>
          )}
          {ordered.length === 0 && <span className="text-[10px] text-[#C7C7CC]">未标记</span>}
        </div>
      </div>
    </div>
  )
}
