import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Download,
  Home,
  Users,
  Sparkles,
  Settings,
  ScrollText,
  HardDrive,
  LayoutGrid,
  Tags
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const navItems = [
  { path: '/', label: '数据概览', icon: Home },
  { path: '/browse', label: '视频浏览', icon: LayoutGrid },
  { path: '/users', label: '用户管理', icon: Users },
  { path: '/download', label: '下载任务', icon: Download },
  { path: '/files', label: '文件管理', icon: HardDrive },
  { path: '/analysis', label: '视频分析', icon: Sparkles },
  { path: '/tags', label: '标签管理', icon: Tags },
  { path: '/logs', label: '同步日志', icon: ScrollText },
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
        const { user, isNewUser, postDownload } = await window.api.user.add(pendingLink)
        const prefix = isNewUser ? `已添加用户: ${user.nickname}` : `用户 ${user.nickname} 已存在`
        if (postDownload.status === 'downloading') {
          toast.success(`${prefix}，正在后台下载作品...`)
        } else if (postDownload.status === 'already-downloaded') {
          toast.success(`${prefix}，该作品已下载过`)
        } else if (isNewUser) {
          toast.success(prefix)
        } else {
          toast.info(prefix)
        }
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

  useEffect(() => {
    const unsubscribe = window.api.user.onAddPostProgress((progress) => {
      if (progress.status === 'success') {
        toast.success(`作品下载完成：${progress.nickname}`)
      } else if (progress.status === 'already-downloaded') {
        // 后台二次去重触发（并发场景），静默忽略
      } else {
        toast.error(`作品下载失败：${progress.nickname} - ${progress.error || '未知错误'}`)
      }
    })
    return unsubscribe
  }, [])

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
                <Icon className={cn('h-5 w-5', active ? 'text-[#0A84FF]' : 'text-[#6E6E73]')} />
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
