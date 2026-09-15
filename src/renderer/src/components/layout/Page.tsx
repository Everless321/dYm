import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 页面根容器：占满侧栏右侧区域，头部固定、内容区自行滚动 */
export function Page({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex-1 flex flex-col h-full min-h-0 overflow-hidden', className)}>
      {children}
    </div>
  )
}

const WIDTHS = {
  /** 表单 / 设置类页面 */
  default: 'max-w-6xl',
  /** 大表格 */
  wide: 'max-w-[1600px]',
  /** 网格 / 工作台，不限宽 */
  full: ''
} as const

interface PageBodyProps {
  children: ReactNode
  width?: keyof typeof WIDTHS
  /** 内容区不滚动、由子元素自己撑满并滚动（如日志表） */
  fill?: boolean
  className?: string
}

/** 页面内容区：统一 p-6 内边距、区块之间 space-y-6，内容居中限宽 */
export function PageBody({
  children,
  width = 'default',
  fill = false,
  className
}: PageBodyProps): React.JSX.Element {
  return (
    <div className={cn('flex-1 min-h-0 p-6', fill ? 'overflow-hidden' : 'overflow-y-auto')}>
      <div
        className={cn(
          'mx-auto w-full',
          WIDTHS[width],
          fill ? 'h-full flex flex-col min-h-0' : 'space-y-6',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** 设置页里的分组：小字分类 + 标题 + 内容 */
export function Section({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-4">
      <div>
        {eyebrow && (
          <p className="text-xs font-semibold text-[#6E6E73] uppercase tracking-widest">
            {eyebrow}
          </p>
        )}
        <h2 className="text-lg font-semibold text-[#1D1D1F] mt-1">{title}</h2>
        {description && <p className="text-sm text-[#6E6E73] mt-1">{description}</p>}
      </div>
      {children}
    </section>
  )
}
