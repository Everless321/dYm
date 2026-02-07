import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Download, Home, Users, Sparkles, Settings, ScrollText, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

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
  const navigate = useNavigate()
  const [pendingLink, setPendingLink] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [setupPath, setSetupPath] = useState('')

  // 首次启动检测
  useEffect(() => {
    window.api.settings.get('download_path').then((val) => {
      setSetupRequired(!val || !val.trim())
    })
  }, [])

  const handleSetupSelectDir = async () => {
    const path = await window.api.system.openDirectoryDialog()
    if (path) setSetupPath(path)
  }

  const handleSetupConfirm = async () => {
    if (!setupPath.trim()) return
    await window.api.settings.set('download_path', setupPath)
    setSetupRequired(false)
    toast.success('下载目录已设置')
  }

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

  if (setupRequired === null) return null

  if (setupRequired) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F5F5F7]">
        <div className="w-[480px] bg-white rounded-2xl border border-[#E5E5E7] shadow-lg p-8">
          <div className="flex items-center gap-3 mb-6">
            <Download className="h-8 w-8 text-[#0A84FF]" />
            <h1 className="text-xl font-semibold text-[#1D1D1F]">欢迎使用 dYm</h1>
          </div>

          <p className="text-sm text-[#6E6E73] mb-6">
            开始之前，请选择一个目录用于存放下载的视频文件。该目录将作为所有视频的默认保存位置。
          </p>

          <div className="flex items-center gap-2 mb-6">
            <div className="flex-1 h-10 px-3 flex items-center rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] overflow-hidden">
              <span className="truncate">{setupPath || '请选择下载目录...'}</span>
            </div>
            <button
              onClick={handleSetupSelectDir}
              className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-[#E5E5E7] bg-[#F5F5F7] hover:bg-[#E8E8ED] transition-colors"
            >
              <FolderOpen className="h-4 w-4 text-[#6E6E73]" />
            </button>
          </div>

          <button
            onClick={handleSetupConfirm}
            disabled={!setupPath.trim()}
            className="w-full h-10 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            确认并开始使用
          </button>
        </div>
      </div>
    )
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
