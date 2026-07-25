import { cn } from '@/lib/utils'
import { ACCENT } from './tokens'

interface StatCardProps {
  label: string
  value: number
  color?: string
  /** 传入后卡片可点击（用作筛选器）；active 时高亮描边 */
  onClick?: () => void
  active?: boolean
}

/** 统一的统计卡片，替代此前在总览/标签库/重标弹窗中重复定义的多个版本 */
export function StatCard({ label, value, color = ACCENT.neutral, onClick, active }: StatCardProps) {
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick?.() : undefined}
      className={cn(
        'rounded-xl bg-white shadow-sm px-5 py-4 transition-all',
        active ? 'ring-2 ring-[#0A84FF]' : 'ring-1 ring-black/[0.04]',
        clickable && 'cursor-pointer hover:shadow-md hover:-translate-y-0.5'
      )}
    >
      <div className="text-xs text-[#A1A1A6]">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1.5" style={{ color }}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}
