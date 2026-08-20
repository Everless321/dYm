import { ReactNode } from 'react'
import { ChevronDown, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 筛选栏里的可折叠分组。activeCount > 0 时标题旁显示已选数量。
 * search 固定在顶部不随列表滚动；children 超过高度后独立滚动，
 * 避免上千项的分组把整个筛选栏撑开。
 *
 * 展开状态与排序都由外部持有（见 panel-prefs.ts）—— 本页会因为进详情页而卸载，
 * 状态放在组件内部就会在返回时全部丢失。
 */
export function FilterSection({
  title,
  activeCount = 0,
  open,
  onToggle,
  onMoveUp,
  onMoveDown,
  onClear,
  search,
  footer,
  children
}: {
  title: string
  activeCount?: number
  open: boolean
  onToggle: () => void
  /** 传入才显示对应按钮；已在首位/末位时由调用方传 undefined */
  onMoveUp?: () => void
  onMoveDown?: () => void
  onClear?: () => void
  /** 固定在列表上方的搜索框 */
  search?: ReactNode
  /** 固定在列表下方的提示（如「还有 N 项未显示」） */
  footer?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="border-b border-[#F0F0F2] last:border-b-0 py-3">
      <div className="group flex items-center justify-between gap-1 px-1">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-medium text-[#6E6E73] hover:text-[#1D1D1F]"
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')}
          />
          <span className="truncate">{title}</span>
          {activeCount > 0 && (
            <span className="ml-0.5 shrink-0 rounded-full bg-[#0A84FF] px-1.5 text-[10px] font-semibold text-white tabular-nums">
              {activeCount}
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {activeCount > 0 && onClear && (
            <button
              onClick={onClear}
              className="text-[10px] text-[#A1A1A6] hover:text-[#0A84FF] shrink-0"
            >
              清除
            </button>
          )}
          {/* 排序按钮平时隐去，避免六个分组各挂两个按钮把筛选栏塞满 */}
          <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <MoveButton label="上移" onClick={onMoveUp} icon={<ArrowUp className="h-3 w-3" />} />
            <MoveButton
              label="下移"
              onClick={onMoveDown}
              icon={<ArrowDown className="h-3 w-3" />}
            />
          </div>
        </div>
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

function MoveButton({
  label,
  onClick,
  icon
}: {
  label: string
  onClick?: () => void
  icon: ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      title={label}
      aria-label={label}
      className="rounded p-0.5 text-[#A1A1A6] hover:bg-[#F5F5F7] hover:text-[#1D1D1F] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#A1A1A6]"
    >
      {icon}
    </button>
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
}): React.JSX.Element {
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
