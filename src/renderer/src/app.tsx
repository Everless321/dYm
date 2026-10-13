import { useEffect, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { Download } from 'lucide-react'
import { router } from './routes'
import { router as legacyRouter } from './legacy/routes'
import { getUiVersion, setUiVersion, type UiVersion } from './lib/ui-version'

function UiVersionChooser(): React.JSX.Element {
  const choose = (version: UiVersion): void => {
    void setUiVersion(version)
  }
  return (
    <div className="grid h-screen place-items-center bg-[var(--bg)]">
      <div className="w-[420px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
            <Download size={16} />
          </span>
          <span className="text-lg font-semibold text-[var(--text-primary)]">dYm</span>
        </div>
        <h1 className="mt-4 text-base font-semibold text-[var(--text-primary)]">选择界面版本</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          dYm 已按新的信息架构重新设计了界面。你可以随时在「设置 → 关于 → 界面版本」中切换。
        </p>
        <div className="mt-5 space-y-2">
          <button
            onClick={() => choose('new')}
            className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            使用新版界面（推荐）
          </button>
          <button
            onClick={() => choose('legacy')}
            className="w-full rounded-[var(--radius-md)] border border-[var(--border)] px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            继续使用经典界面
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App(): React.JSX.Element | null {
  const [uiVersion, setVersion] = useState<UiVersion | null | 'loading'>('loading')
  useEffect(() => {
    void getUiVersion().then(setVersion)
  }, [])
  if (uiVersion === 'loading') return null
  if (uiVersion === null) return <UiVersionChooser />
  return <RouterProvider router={uiVersion === 'legacy' ? legacyRouter : router} />
}
