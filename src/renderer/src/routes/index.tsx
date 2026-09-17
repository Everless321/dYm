import { lazy } from 'react'
import { createHashRouter, Navigate, useParams } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import BrowsePage from '@/pages/browse/BrowsePage'
import UsersPage from '@/pages/users/UsersPage'
import DownloadPage from '@/pages/download/DownloadPage'
import TaskDetailPage from '@/pages/download/TaskDetailPage'
import AnalysisPage from '@/pages/analysis/AnalysisPage'
import SystemPage from '@/pages/system/SystemPage'
import LogsPage from '@/pages/logs/LogsPage'
import LiveRecordPage from '@/pages/live/LiveRecordPage'
import FilesPage from '@/pages/files/FilesPage'

// 重依赖页面按路由拆包：recharts / codemirror / 标签工作台只在进入时才加载
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'))
const ScriptsPage = lazy(() => import('@/pages/scripts/ScriptsPage'))
const TagWorkbenchPage = lazy(() => import('@/pages/tags/TagWorkbenchPage'))
const VideoTagEditPage = lazy(() => import('@/pages/tags/VideoTagEditPage'))
const TagLibraryPage = lazy(() => import('@/pages/tags/TagLibraryPage'))

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
        element: <BrowsePage />
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
      },
      {
        path: 'scripts',
        element: <ScriptsPage />
      }
    ]
  },
  {
    path: '/settings/*',
    element: <Navigate to="/" replace />
  }
])
