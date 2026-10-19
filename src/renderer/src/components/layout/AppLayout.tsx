import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { WelcomeDialog } from '@/components/dialogs/WelcomeDialog'
import { DEVELOPER_MODE_EVENT } from '@/lib/developer-mode'
import { CREATOR_PLATFORM_LABEL, detectCreatorPlatform } from '@shared/platforms'
import { Sidebar } from './Sidebar'

export function AppLayout(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const [developerMode, setDeveloperMode] = useState<boolean | null>(null)

  useEffect(() => {
    window.api.settings
      .get('developer_mode')
      .then((value) => setDeveloperMode(value === 'true'))
      .catch(() => setDeveloperMode(false))

    const handler = (event: Event): void => {
      setDeveloperMode((event as CustomEvent<boolean>).detail)
    }
    window.addEventListener(DEVELOPER_MODE_EVENT, handler)
    return () => window.removeEventListener(DEVELOPER_MODE_EVENT, handler)
  }, [])

  useEffect(() => {
    if (developerMode === false && location.pathname.startsWith('/scripts')) {
      navigate('/', { replace: true })
    }
  }, [developerMode, location.pathname, navigate])

  useEffect(() => {
    return window.api.clipboard.onDouyinLink((link) => {
      const platform = detectCreatorPlatform(link)
      toast(platform ? `检测到${CREATOR_PLATFORM_LABEL[platform]}链接` : '检测到创作者链接', {
        description: link.length > 50 ? `${link.slice(0, 50)}…` : link,
        duration: 8000,
        action: {
          label: '添加创作者',
          // 打开添加弹窗并预填链接，方便按平台设置下载内容
          onClick: () => navigate(`/creators?draft=${encodeURIComponent(link)}`)
        }
      })
    })
  }, [navigate])

  useEffect(() => {
    return window.api.user.onAddPostProgress((progress) => {
      if (progress.status === 'success') toast.success(`作品下载完成：${progress.nickname}`)
      else if (progress.status === 'failed') {
        toast.error(`作品下载失败：${progress.nickname} - ${progress.error || '未知错误'}`)
      }
    })
  }, [])

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]">
      <WelcomeDialog />
      <Sidebar developerMode={developerMode === true} />
      <main data-overlay-root className="relative min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
