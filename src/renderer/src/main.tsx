import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { toast } from 'sonner'
import { router } from './routes'
import { Toaster } from './components/ui/sonner'
import { ErrorBoundary } from './components/ErrorBoundary'

// 未被 catch 的 Promise 异常兜底：避免静默失败
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason)
  const message = event.reason?.message ?? String(event.reason)
  toast.error(`操作失败: ${message}`)
})

// Toaster 放在 ErrorBoundary 外层，页面崩溃后仍能弹出提示
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
    <Toaster position="top-center" />
  </StrictMode>
)
