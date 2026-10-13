import { lazy } from 'react'
import { createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { CreatorsLayout } from '@/components/layout/CreatorsLayout'
import { LibraryLayout } from '@/components/layout/LibraryLayout'
import {
  LegacyAnalysisRedirect,
  LegacyTagRedirect,
  TagUserRedirect
} from '@/routes/LegacyRedirects'
import BrowsePage from '@/pages/browse/BrowsePage'
import UsersPage from '@/pages/users/UsersPage'
import DownloadPage from '@/pages/download/DownloadPage'
import TaskDetailPage from '@/pages/download/TaskDetailPage'
import AnalysisPage from '@/pages/analysis/AnalysisPage'
import SystemPage from '@/pages/system/SystemPage'
import LogsPage from '@/pages/logs/LogsPage'
import LiveRecordPage from '@/pages/live/LiveRecordPage'
import FilesPage from '@/pages/files/FilesPage'

const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'))
const ScriptsPage = lazy(() => import('@/pages/scripts/ScriptsPage'))
const TagWorkbenchPage = lazy(() => import('@/pages/tags/TagWorkbenchPage'))
const VideoTagEditPage = lazy(() => import('@/pages/tags/VideoTagEditPage'))
const TagLibraryPage = lazy(() => import('@/pages/tags/TagLibraryPage'))

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'browse', element: <BrowsePage /> },
      {
        path: 'library',
        element: <LibraryLayout />,
        children: [
          { index: true, element: <Navigate to="/library/videos" replace /> },
          { path: 'videos', element: <TagWorkbenchPage /> },
          { path: 'jobs', element: <AnalysisPage /> },
          { path: 'tags', element: <TagLibraryPage /> }
        ]
      },
      {
        path: 'creators',
        element: <CreatorsLayout />,
        children: [
          { index: true, element: <UsersPage /> },
          { path: 'files', element: <FilesPage /> }
        ]
      },
      { path: 'live', element: <LiveRecordPage /> },
      { path: 'settings', element: <Navigate to="/settings/account" replace /> },
      { path: 'settings/:section', element: <SystemPage /> },
      { path: 'logs', element: <LogsPage /> },
      { path: 'tasks', element: <DownloadPage /> },
      { path: 'tasks/:id', element: <TaskDetailPage /> },
      { path: 'scripts', element: <ScriptsPage /> },
      { path: 'users', element: <Navigate to="/creators" replace /> },
      { path: 'files', element: <Navigate to="/creators/files" replace /> },
      { path: 'download', element: <Navigate to="/creators" replace /> },
      { path: 'download/:id', element: <Navigate to="/creators" replace /> },
      { path: 'analysis', element: <LegacyAnalysisRedirect /> },
      { path: 'tags', element: <LegacyTagRedirect /> },
      { path: 'tags/library', element: <Navigate to="/library/tags" replace /> },
      { path: 'tags/user/:secUid', element: <TagUserRedirect /> },
      { path: 'tags/video/:postId', element: <VideoTagEditPage /> },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
])
