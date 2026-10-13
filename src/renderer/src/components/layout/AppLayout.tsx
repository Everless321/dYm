import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { WelcomeDialog } from '@/components/dialogs/WelcomeDialog'
import { DEVELOPER_MODE_EVENT } from '@/lib/developer-mode'
import { Sidebar } from './Sidebar'

export function AppLayout(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const [developerMode, setDeveloperMode] = useState<boolean | null>(null)
  const [adding, setAdding] = useState(false)

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

  const addLink = useCallback(
    async (link: string) => {
      if (adding) return
      setAdding(true)
      try {
        const result = await window.api.user.add(link)
        const prefix = result.isNewUser
          ? `已添加创作者：${result.user.nickname}`
          : `创作者 ${result.user.nickname} 已存在`
        if (result.postDownload.status === 'downloading') {
          toast.success(`${prefix}，正在后台下载作品…`)
        } else if (result.postDownload.status === 'already-downloaded') {
          toast.success(`${prefix}，该作品已下载过`)
        } else if (result.isNewUser) {
          toast.success(prefix)
        } else {
          toast.info(prefix)
        }
        navigate('/creators')
      } catch (error) {
        toast.error(`添加失败: ${(error as Error).message}`)
      } finally {
        setAdding(false)
      }
    },
    [adding, navigate]
  )

  useEffect(() => {
    return window.api.clipboard.onDouyinLink((link) => {
      toast('检测到抖音链接', {
        description: link.length > 50 ? `${link.slice(0, 50)}…` : link,
        duration: 8000,
        action: {
          label: '添加创作者',
          onClick: () => void addLink(link)
        }
      })
    })
  }, [addLink])

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
      <main className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
