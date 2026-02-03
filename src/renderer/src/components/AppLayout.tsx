import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Download, Home, Users, Sparkles, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const navItems = [
  { path: '/', label: '首页', icon: Home },
  { path: '/users', label: '用户管理', icon: Users },
  { path: '/download', label: '下载任务', icon: Download },
  { path: '/analysis', label: '视频分析', icon: Sparkles },
  { path: '/settings', label: '系统设置', icon: Settings }
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [pendingLink, setPendingLink] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)

  // 监听剪贴板中的抖音链接
  useEffect(() => {
    const cleanup = window.api.clipboard.onDouyinLink((link) => {
      // 显示提示
      toast('检测到抖音链接', {
        description: link.length > 50 ? link.substring(0, 50) + '...' : link,
        duration: 8000,
        action: {
          label: '添加用户',
          onClick: () => {
            setPendingLink(link)
          }
        }
      })
    })

    return cleanup
  }, [])

  // 处理添加用户
  useEffect(() => {
    if (!pendingLink || isAdding) return

    const addUser = async () => {
      setIsAdding(true)
      try {
        const user = await window.api.user.add(pendingLink)
        toast.success(`已添加用户: ${user.nickname}`)
        // 导航到用户管理页面
        navigate('/users')
      } catch (error) {
        toast.error(`添加失败: ${(error as Error).message}`)
      } finally {
        setIsAdding(false)
        setPendingLink(null)
      }
    }

    addUser()
  }, [pendingLink, isAdding, navigate])

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="h-screen flex bg-[#FDFCFB]">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col bg-white border-r border-[#EAE6E1]">
        {/* Logo */}
        <div className="h-[72px] flex items-center gap-3 px-6 border-b border-[#EAE6E1]">
          <Download className="h-7 w-7 text-[#FE2C55]" />
          <span className="text-lg font-semibold text-[#312E2A]">dYm</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          <span className="block px-4 py-2 text-[11px] font-medium text-[#B8B2AD] font-mono tracking-wide">
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
                    ? 'bg-[#FEE2E8] text-[#312E2A] font-medium'
                    : 'text-[#7A7570] hover:bg-[#F7F5F3]'
                )}
              >
                <Icon
                  className={cn('h-5 w-5', active ? 'text-[#FE2C55]' : 'text-[#7A7570]')}
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
