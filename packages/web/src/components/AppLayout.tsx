import { Link, Outlet, useLocation } from 'react-router-dom'
import { Download, Home, Users, Sparkles, Settings, ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { path: '/', label: '首页', icon: Home },
  { path: '/users', label: '用户管理', icon: Users },
  { path: '/download', label: '下载任务', icon: Download },
  { path: '/analysis', label: '视频分析', icon: Sparkles },
  { path: '/logs', label: '同步日志', icon: ScrollText },
  { path: '/settings', label: '系统设置', icon: Settings }
]

export function AppLayout() {
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="h-screen flex bg-[#F5F5F7]">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col bg-white border-r border-[#E5E5E7]">
        {/* Logo */}
        <div className="h-[72px] flex items-center gap-3 px-6 border-b border-[#E5E5E7]">
          <Download className="h-7 w-7 text-[#0A84FF]" />
          <span className="text-lg font-semibold text-[#1D1D1F]">dYm</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          <span className="block px-4 py-2 text-[11px] font-medium text-[#A1A1A6] font-mono tracking-wide">
            菜单
          </span>
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.path)
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-3 h-12 px-4 rounded-lg transition-colors',
                  active
                    ? 'bg-[#E8F0FE] text-[#1D1D1F] font-medium'
                    : 'text-[#6E6E73] hover:bg-[#F2F2F4]'
                )}
              >
                <Icon
                  className={cn('h-5 w-5', active ? 'text-[#0A84FF]' : 'text-[#6E6E73]')}
                />
                <span className="text-sm">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
