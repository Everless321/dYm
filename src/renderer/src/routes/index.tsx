import { createHashRouter, Navigate, useParams } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import DashboardPage from '@/pages/DashboardPage'
import HomePage from '@/pages/HomePage'
import UsersPage from '@/pages/settings/UsersPage'
import DownloadPage from '@/pages/settings/DownloadPage'
import TaskDetailPage from '@/pages/settings/TaskDetailPage'
import AnalysisPage from '@/pages/settings/AnalysisPage'
import SystemPage from '@/pages/settings/SystemPage'
import LogsPage from '@/pages/settings/LogsPage'
import LiveRecordPage from '@/pages/settings/LiveRecordPage'
import FilesPage from '@/pages/settings/FilesPage'
import TagWorkbenchPage from '@/pages/tags/TagWorkbenchPage'
import VideoTagEditPage from '@/pages/tags/VideoTagEditPage'
import TagLibraryPage from '@/pages/tags/TagLibraryPage'

/** 旧的按用户查看页已并入工作台，保留路由做重定向（外部链接/历史记录仍可用） */
function TagUserRedirect() {
  const { secUid = '' } = useParams()
  return <Navigate to={`/tags?user=${encodeURIComponent(secUid)}`} replace />
}

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <DashboardPage />
      },
      {
        path: 'browse',
        element: <HomePage />
      },
      {
        path: 'users',
        element: <UsersPage />
      },
      {
        path: 'download',
        element: <DownloadPage />
      },
      {
        path: 'download/:id',
        element: <TaskDetailPage />
      },
      {
        path: 'files',
        element: <FilesPage />
      },
      {
        path: 'analysis',
        element: <AnalysisPage />
      },
      {
        path: 'tags',
        element: <TagWorkbenchPage />
      },
      {
        path: 'tags/library',
        element: <TagLibraryPage />
      },
      {
        path: 'tags/user/:secUid',
        element: <TagUserRedirect />
      },
      {
        path: 'tags/video/:postId',
        element: <VideoTagEditPage />
      },
      {
        path: 'settings',
        element: <SystemPage />
      },
      {
        path: 'logs',
        element: <LogsPage />
      },
      {
        path: 'live',
        element: <LiveRecordPage />
      }
    ]
  },
  {
    path: '/settings/*',
    element: <Navigate to="/" replace />
  }
])
