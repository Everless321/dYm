import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { getAvatarUrl } from '@/lib/utils'

interface UserProfileBarProps {
  user: UserTagStats
  /** 点标签 → 追加到标签筛选 */
  onTagClick: (tag: string) => void
  onClear: () => void
}

const TOP_TAGS = 8

/** 筛选到单个用户时的内容画像：标注进度 + 该用户高频标签 */
export function UserProfileBar({
  user,
  onTagClick,
  onClear
}: UserProfileBarProps): React.JSX.Element {
  const [tags, setTags] = useState<TagFrequencyItem[]>([])

  useEffect(() => {
    window.api.tag.getTagsWithFrequency(user.sec_uid).then(setTags)
  }, [user.sec_uid])

  const pct = user.total ? Math.round((user.tagged / user.total) * 100) : 0
  const top = tags.slice(0, TOP_TAGS)
  const maxCount = top[0]?.count || 1

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-black/[0.04] px-5 py-4 flex items-start gap-5">
      <Avatar className="h-14 w-14 shrink-0">
        <AvatarImage src={getAvatarUrl(user)} />
        <AvatarFallback>{user.nickname?.[0] || '?'}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 w-56 shrink-0 space-y-1.5">
        <p className="text-sm font-medium text-[#1D1D1F] truncate">{user.nickname}</p>
        <Progress value={pct} className="h-1.5" />
        <p className="text-xs text-[#A1A1A6] tabular-nums">
          已标记 {user.tagged}/{user.total}
          <span className="ml-1.5">（{pct}%）</span>
        </p>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[#A1A1A6] mb-2">
          高频标签{tags.length > TOP_TAGS && ` · 共 ${tags.length} 种`}
        </p>
        {top.length === 0 ? (
          <p className="text-xs text-[#C7C7CC]">该用户还没有任何标签</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {top.map((t) => (
              <button
                key={t.tag}
                onClick={() => onTagClick(t.tag)}
                title={`筛选「${t.tag}」`}
                className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-[#E5E5E7] px-2.5 py-1 text-xs text-[#1D1D1F] hover:border-[#0A84FF] transition-colors"
              >
                {/* 条形长度反映相对频次 */}
                <span
                  className="absolute inset-y-0 left-0 bg-[#E8F0FE] group-hover:bg-[#D6E6FD] transition-colors"
                  style={{ width: `${(t.count / maxCount) * 100}%` }}
                />
                <span className="relative">{t.tag}</span>
                <span className="relative text-[10px] text-[#6E6E73] tabular-nums">{t.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onClear}
        title="取消用户筛选"
        className="shrink-0 rounded-md p-1.5 text-[#A1A1A6] hover:bg-[#F5F5F7] hover:text-[#1D1D1F]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
