import { createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import DashboardPage from '@/pages/DashboardPage'
import HomePage from '@/pages/HomePage'
import UsersPage from '@/pages/settings/UsersPage'
import DownloadPage from '@/pages/settings/DownloadPage'
import TaskDetailPage from '@/pages/settings/TaskDetailPage'
import AnalysisPage from '@/pages/settings/AnalysisPage'
import SystemPage from '@/pages/settings/SystemPage'
import LogsPage from '@/pages/settings/LogsPage'
import FilesPage from '@/pages/settings/FilesPage'
import TagOverviewPage from '@/pages/tags/TagOverviewPage'
import UserTagLibraryPage from '@/pages/tags/UserTagLibraryPage'
import VideoTagEditPage from '@/pages/tags/VideoTagEditPage'
import TagLibraryPage from '@/pages/tags/TagLibraryPage'

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
        element: <TagOverviewPage />
      },
      {
        path: 'tags/library',
        element: <TagLibraryPage />
      },
      {
        path: 'tags/user/:secUid',
        element: <UserTagLibraryPage />
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
      }
    ]
  },
  {
    path: '/settings/*',
    element: <Navigate to="/" replace />
  }
])
