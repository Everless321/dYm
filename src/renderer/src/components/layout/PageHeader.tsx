import { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'

interface PageHeaderProps {
  /** 标题；与 description / meta 组成默认左侧内容 */
  title?: ReactNode
  /** 标题下方一行小字说明 */
  description?: ReactNode
  /** 标题右侧的小字统计（如「(12)」「3 路录制中」） */
  meta?: ReactNode
  /** 完全自定义左侧（面包屑、返回按钮等），传了就忽略 title / description / meta */
  left?: ReactNode
  /** 右侧操作区 */
  actions?: ReactNode
}

/** 页头外壳：统一 h-16 白底分隔线、px-6，左右两个插槽 */
export function PageHeader({
  title,
  description,
  meta,
  left,
  actions
}: PageHeaderProps): React.JSX.Element {
  return (
    <header className="h-16 flex items-center justify-between gap-4 px-6 border-b border-[#E5E5E7] bg-white shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {left ?? (
          <div className="min-w-0">
            <div className="flex items-baseline gap-3 min-w-0">
              <h1 className="text-xl font-semibold text-[#1D1D1F] truncate">{title}</h1>
              {meta && <span className="text-sm text-[#A1A1A6] shrink-0">{meta}</span>}
            </div>
            {description && <p className="text-sm text-[#6E6E73] mt-0.5 truncate">{description}</p>}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  )
}

export interface Crumb {
  label: ReactNode
  onClick?: () => void
}

/** 面包屑：首项带返回箭头且可点，末项加粗不可点 */
export function Crumbs({ items }: { items: Crumb[] }): React.JSX.Element {
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
export function BackLink({
  label,
  onClick
}: {
  label: string
  onClick: () => void
}): React.JSX.Element {
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
