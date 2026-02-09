import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        lazy: () => import('@/pages/HomePage').then((m) => ({ Component: m.default }))
      },
      {
        path: 'users',
        lazy: () => import('@/pages/settings/UsersPage').then((m) => ({ Component: m.default }))
      },
      {
        path: 'download',
        lazy: () => import('@/pages/settings/DownloadPage').then((m) => ({ Component: m.default }))
      },
      {
        path: 'download/:id',
        lazy: () =>
          import('@/pages/settings/TaskDetailPage').then((m) => ({ Component: m.default }))
      },
      {
        path: 'analysis',
        lazy: () =>
          import('@/pages/settings/AnalysisPage').then((m) => ({ Component: m.default }))
      },
      {
        path: 'settings',
        lazy: () => import('@/pages/settings/SystemPage').then((m) => ({ Component: m.default }))
      },
      {
        path: 'logs',
        lazy: () => import('@/pages/settings/LogsPage').then((m) => ({ Component: m.default }))
      }
    ]
  }
])
