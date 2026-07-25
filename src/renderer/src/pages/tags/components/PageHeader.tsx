import { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'

/** 页头外壳：统一 h-16 白底分隔线，左右两个插槽 */
export function PageHeader({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="h-16 flex items-center justify-between px-8 border-b border-[#E5E5E7] bg-white shrink-0">
      <div className="flex items-center gap-2 min-w-0">{left}</div>
      {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
    </div>
  )
}

export interface Crumb {
  label: ReactNode
  onClick?: () => void
}

/** 面包屑：首项带返回箭头且可点，末项加粗不可点 */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <div className="flex items-center gap-2 text-sm min-w-0">
      {items.map((c, i) => {
        const isLast = i === items.length - 1
        return (
          <div key={i} className="flex items-center gap-2 min-w-0">
            {i > 0 && <span className="text-[#D1D1D6]">/</span>}
            {c.onClick && !isLast ? (
              <button
                onClick={c.onClick}
                className="flex items-center gap-1 text-[#6E6E73] hover:text-[#1D1D1F] whitespace-nowrap"
              >
                {i === 0 && <ChevronLeft className="h-4 w-4" />}
                {c.label}
              </button>
            ) : (
              <span className="font-medium text-[#1D1D1F] truncate">{c.label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 单独的返回链接（无面包屑链的页面用） */
export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-sm text-[#6E6E73] hover:text-[#1D1D1F]"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </button>
  )
}
