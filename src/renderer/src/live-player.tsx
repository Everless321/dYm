import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import LivePlayerWindow from './pages/LivePlayerWindow'

// 主进程通过 hash 传入 recordId，例如 live-player.html#123
const recordId = parseInt(window.location.hash.replace('#', ''), 10)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LivePlayerWindow recordId={Number.isFinite(recordId) ? recordId : null} />
  </StrictMode>
)
