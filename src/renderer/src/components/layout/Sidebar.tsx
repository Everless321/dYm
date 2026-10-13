import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  CodeXml,
  Download,
  House,
  LibraryBig,
  Link2,
  Radio,
  Settings,
  Users
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SidebarProps {
  developerMode: boolean
  onAddLink: (link: string) => void
  adding: boolean
}

interface NavigationItem {
  label: string
  to: string
  icon: LucideIcon
  active?: (pathname: string) => boolean
  badge?: number
}

export function Sidebar({ developerMode, onAddLink, adding }: SidebarProps): React.JSX.Element {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === '1'
  )
  const [syncingIds, setSyncingIds] = useState<Set<number> | null>(null)
  const [liveIds, setLiveIds] = useState<Set<number> | null>(null)
  const syncingCount = syncingIds?.size ?? 0
  const liveCount = liveIds?.size ?? 0
  const [unanalyzedCount, setUnanalyzedCount] = useState<number | null>(null)
  const [cookieConfigured, setCookieConfigured] = useState<boolean | null>(null)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [link, setLink] = useState('')
  const linkInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void Promise.all([
      window.api.sync.getAllSyncing().then((ids) => setSyncingIds(new Set(ids))),
      window.api.live.getRecordingUsers().then((ids) => setLiveIds(new Set(ids))),
      window.api.analysis.getUnanalyzedCount().then(setUnanalyzedCount),
      window.api.settings
        .get('douyin_cookie')
        .then((cookie) => setCookieConfigured(Boolean(cookie)))
    ]).catch(() => undefined)

    const unsubscribeSync = window.api.sync.onProgress((progress) => {
      setSyncingIds((current) => {
        const next = new Set(current ?? [])
        if (progress.status === 'syncing') next.add(progress.userId)
        else next.delete(progress.userId)
        return next
      })
    })
    const unsubscribeLive = window.api.live.onProgress((progress) => {
      setLiveIds((current) => {
        const next = new Set(current ?? [])
        if (progress.status === 'recording') next.add(progress.userId)
        else if (['completed', 'stopped', 'failed'].includes(progress.status)) {
          next.delete(progress.userId)
        }
        return next
      })
    })
    const unsubscribeAnalysis = window.api.analysis.onQueue(() => {
      window.api.analysis
        .getUnanalyzedCount()
        .then(setUnanalyzedCount)
        .catch(() => undefined)
    })
    return () => {
      unsubscribeSync()
      unsubscribeLive()
      unsubscribeAnalysis()
    }
  }, [])

  useEffect(() => {
    if (quickAddOpen) window.setTimeout(() => linkInputRef.current?.focus(), 0)
  }, [quickAddOpen])

  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      localStorage.setItem('sidebar_collapsed', current ? '0' : '1')
      return !current
    })
  }

  const items: NavigationItem[] = [
    { label: '概览', to: '/', icon: House, active: (path) => path === '/' },
    { label: '视频浏览', to: '/browse', icon: Clapperboard },
    {
      label: '内容库',
      to: '/library/videos',
      icon: LibraryBig,
      active: (path) => path.startsWith('/library')
    },
    {
      label: '创作者',
      to: '/creators',
      icon: Users,
      active: (path) => path.startsWith('/creators')
    },
    {
      label: '直播录制',
      to: '/live',
      icon: Radio,
      badge: liveCount,
      active: (path) => path.startsWith('/live')
    }
  ]
  if (developerMode) items.push({ label: '自定义脚本', to: '/scripts', icon: CodeXml })

  const submitLink = (event: React.FormEvent): void => {
    event.preventDefault()
    const value = link.trim()
    if (!value || adding) return
    onAddLink(value)
    setLink('')
    setQuickAddOpen(false)
  }

  return (
    <aside
      className={`flex h-full shrink-0 flex-col gap-5 border-r border-[var(--border)] bg-[var(--surface)] px-3 py-5 transition-[width] ${
        collapsed ? 'w-[64px]' : 'w-[232px]'
      }`}
    >
      <div
        className={`flex h-9 items-center ${collapsed ? 'justify-center' : 'justify-between px-2'}`}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="展开侧边栏"
            title="展开侧边栏"
            className="rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--surface-muted)]"
          >
            <ChevronRight size={16} />
          </button>
        ) : (
          <>
            <Link
              to="/"
              className="flex items-center gap-2.5 overflow-hidden"
              aria-label="dYm 概览"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
                <Download size={16} />
              </span>
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="text-base font-semibold tracking-tight">dYm</span>
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">3.2</span>
              </span>
            </Link>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="收起侧边栏"
              className="rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--surface-muted)]"
            >
              <ChevronLeft size={16} />
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        className={`flex h-[38px] items-center justify-center gap-2 rounded-md bg-[#1D1D1F] px-3 text-sm font-medium text-white transition-colors hover:bg-black ${
          collapsed ? 'w-full' : ''
        }`}
      >
        <Link2 size={16} />
        {!collapsed && (
          <>
            <span>粘贴链接添加</span>
            <kbd className="ml-auto rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/70">
              ⌘V
            </kbd>
          </>
        )}
      </button>

      <nav className="flex flex-col gap-1">
        {items.map(({ label, to, icon: Icon, badge, active }) => {
          const selected = active?.(location.pathname) ?? location.pathname === to
          return (
            <Link
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
                selected
                  ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]'
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <Icon size={18} strokeWidth={1.8} />
              {!collapsed && <span className="min-w-0 flex-1">{label}</span>}
              {!collapsed && badge !== undefined && badge > 0 && (
                <span className="min-w-5 rounded-full bg-[var(--live)] px-1.5 py-0.5 text-center text-[10px] font-semibold leading-4 text-white">
                  {badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="flex-1" />

      {!collapsed && (
        <section className="rounded-lg bg-[var(--surface-muted)] p-3">
          <div className="space-y-2 text-xs text-[var(--text-secondary)]">
            {syncingIds !== null && (
              <StatusLine color="var(--accent)" label={`${syncingCount} 位创作者同步中`} />
            )}
            {liveIds !== null && (
              <StatusLine color="var(--live)" label={`${liveCount} 场直播录制中`} />
            )}
            {unanalyzedCount !== null && (
              <StatusLine color="var(--warning)" label={`AI 待分析 · 剩余 ${unanalyzedCount} 条`} />
            )}
            {cookieConfigured !== null && (
              <StatusLine
                color={cookieConfigured ? 'var(--success)' : 'var(--warning)'}
                label={cookieConfigured ? 'Cookie 已配置' : 'Cookie 未配置'}
              />
            )}
            {syncingCount === 0 &&
              liveCount === 0 &&
              unanalyzedCount === 0 &&
              cookieConfigured === true && (
                <span className="text-[var(--text-tertiary)]">暂无待处理事项</span>
              )}
          </div>
        </section>
      )}

      <Link
        to="/settings/account"
        title={collapsed ? '设置' : undefined}
        className={`flex h-10 items-center gap-3 rounded-md px-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] ${
          location.pathname.startsWith('/settings')
            ? 'bg-[var(--surface-muted)] text-[var(--text-primary)]'
            : ''
        } ${collapsed ? 'justify-center px-0' : ''}`}
      >
        <Settings size={18} strokeWidth={1.8} />
        {!collapsed && <span className="flex-1">设置</span>}
      </Link>

      <Dialog open={quickAddOpen} onOpenChange={setQuickAddOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>添加创作者或视频</DialogTitle>
            <DialogDescription>粘贴抖音链接，继续使用现有解析与添加流程。</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitLink} className="space-y-4">
            <Input
              ref={linkInputRef}
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="粘贴抖音主页或视频链接"
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setQuickAddOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={!link.trim() || adding}>
                {adding ? '添加中…' : '解析并添加'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

function StatusLine({ color, label }: { color: string; label: string }): React.JSX.Element {
  const colorClass =
    color === 'var(--accent)'
      ? 'bg-[var(--accent)]'
      : color === 'var(--live)'
        ? 'bg-[var(--live)]'
        : color === 'var(--success)'
          ? 'bg-[var(--success)]'
          : 'bg-[var(--warning)]'
  return (
    <div className="flex items-center gap-2">
      <span className={`h-1.5 w-1.5 rounded-full ${colorClass}`} />
      <span>{label}</span>
    </div>
  )
}
