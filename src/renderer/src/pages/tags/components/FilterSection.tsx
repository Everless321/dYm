import { ReactNode, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 筛选栏里的可折叠分组。activeCount > 0 时标题旁显示已选数量。
 * search 固定在顶部不随列表滚动；children 超过高度后独立滚动，
 * 避免上千项的分组把整个筛选栏撑开。
 */
export function FilterSection({
  title,
  activeCount = 0,
  defaultOpen = true,
  onClear,
  search,
  footer,
  children
}: {
  title: string
  activeCount?: number
  defaultOpen?: boolean
  onClear?: () => void
  /** 固定在列表上方的搜索框 */
  search?: ReactNode
  /** 固定在列表下方的提示（如「还有 N 项未显示」） */
  footer?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-[#F0F0F2] last:border-b-0 py-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-[#6E6E73] hover:text-[#1D1D1F]"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
          {title}
          {activeCount > 0 && (
            <span className="ml-0.5 rounded-full bg-[#0A84FF] px-1.5 text-[10px] font-semibold text-white tabular-nums">
              {activeCount}
            </span>
          )}
        </button>
        {activeCount > 0 && onClear && (
          <button
            onClick={onClear}
            className="text-[10px] text-[#A1A1A6] hover:text-[#0A84FF] shrink-0"
          >
            清除
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-1.5">
          {search}
          <div className="space-y-0.5 max-h-56 overflow-y-auto">{children}</div>
          {footer}
        </div>
      )}
    </div>
  )
}

/** 筛选项行：左侧标签，右侧计数，选中态蓝底 */
export function FilterRow({
  label,
  count,
  active,
  onClick
}: {
  label: ReactNode
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-left',
        active ? 'bg-[#E8F0FE] text-[#0A84FF] font-medium' : 'text-[#1D1D1F] hover:bg-[#F5F5F7]'
      )}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className={cn('tabular-nums shrink-0', active ? 'text-[#0A84FF]' : 'text-[#A1A1A6]')}>
          {count}
        </span>
      )}
    </button>
  )
}
