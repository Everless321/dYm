import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Wifi } from 'lucide-react'
import { Section } from '@/components/layout/Page'

function randomToken(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function agentLabel(status: PanelRuntimeStatus | null): string {
  if (!status || status.agent === 'off') return '未连接'
  if (status.agent === 'connecting') return '正在连接'
  if (status.agent === 'online') return '已连接'
  return status.agentError || '连接失败'
}

export function PanelSettingsCard(): React.JSX.Element {
  const [embedEnabled, setEmbedEnabled] = useState(false)
  const [port, setPort] = useState('38600')
  const [lan, setLan] = useState(false)
  const [adminToken, setAdminToken] = useState('')
  const [nodeEnabled, setNodeEnabled] = useState(false)
  const [nodeUrl, setNodeUrl] = useState('')
  const [nodeKey, setNodeKey] = useState('')
  const [nodeName, setNodeName] = useState('')
  const [status, setStatus] = useState<PanelRuntimeStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [issuing, setIssuing] = useState(false)

  const load = async (): Promise<void> => {
    const [settings, runtime] = await Promise.all([
      window.api.settings.getAll(),
      window.api.panel.status()
    ])
    setEmbedEnabled(settings.panel_embed_enabled === 'true')
    setPort(settings.panel_embed_port || '38600')
    setLan(settings.panel_embed_lan === 'true')
    setAdminToken(settings.panel_admin_token || runtime.adminToken || '')
    setNodeEnabled(settings.panel_node_enabled === 'true')
    setNodeUrl(settings.panel_node_url || '')
    setNodeKey(settings.panel_node_api_key || '')
    setNodeName(settings.panel_node_name || '')
    setStatus(runtime)
    setLoaded(true)
  }

  useEffect(() => {
    void load().catch((error) => {
      toast.error(`加载管理端设置失败: ${(error as Error).message}`)
    })
  }, [])

  const persist = async (): Promise<PanelRuntimeStatus> => {
    const parsed = Number.parseInt(port, 10)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error('端口需要在 1 到 65535 之间')
    }
    await window.api.settings.set('panel_embed_enabled', embedEnabled ? 'true' : 'false')
    await window.api.settings.set('panel_embed_port', String(parsed))
    await window.api.settings.set('panel_embed_lan', lan ? 'true' : 'false')
    await window.api.settings.set('panel_admin_token', adminToken.trim())
    await window.api.settings.set('panel_node_enabled', nodeEnabled ? 'true' : 'false')
    await window.api.settings.set('panel_node_url', nodeUrl.trim())
    await window.api.settings.set('panel_node_api_key', nodeKey.trim())
    await window.api.settings.set('panel_node_name', nodeName.trim())
    const runtime = await window.api.panel.apply()
    setStatus(runtime)
    if (runtime.adminToken) setAdminToken(runtime.adminToken)
    return runtime
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await persist()
      toast.success('网络管理设置已保存')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleIssue = async (): Promise<void> => {
    setIssuing(true)
    try {
      if (!embedEnabled) throw new Error('请先启用内置管理端')
      await persist()
      const issued = await window.api.panel.issueLocalKey()
      setNodeEnabled(true)
      setNodeUrl(issued.url)
      setNodeKey(issued.apiKey)
      setStatus(await window.api.panel.status())
      toast.success('已为本机签发密钥并开始注册')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setIssuing(false)
    }
  }

  const entry = status?.urls[0]

  return (
    <Section eyebrow="网络" title="管理端">
      <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
        <p className="text-xs text-[#A1A1A6] mb-4">
          内置管理端和单独运行的网页管理端用的是同一套协议。这台 dYm 填好地址和 API Key
          之后会主动注册上去。先在客户端列表里选一台，再管理那一台的作品、用户和下载任务。登录抖音仍然在各台电脑上完成。
        </p>

        <div className="divide-y divide-[#E5E5E7]">
          <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-[#1D1D1F]">启用内置管理端</p>
              <p className="text-xs text-[#A1A1A6] mt-1">在这台电脑上打开管理页面</p>
            </div>
            <button
              type="button"
              aria-pressed={embedEnabled}
              onClick={() => setEmbedEnabled(!embedEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                embedEnabled ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  embedEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <label className="flex flex-col gap-2 py-4 md:flex-row md:items-center md:justify-between">
            <span className="text-sm text-[#1D1D1F]">端口</span>
            <input
              value={port}
              onChange={(event) => setPort(event.target.value)}
              className="h-9 w-full md:w-40 rounded-lg border border-[#E5E5E7] px-3 text-sm"
            />
          </label>

          <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm text-[#1D1D1F]">允许局域网访问</p>
              <p className="text-xs text-[#A1A1A6] mt-1">其它电脑要连这台管理端时打开</p>
            </div>
            <button
              type="button"
              aria-pressed={lan}
              onClick={() => setLan(!lan)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                lan ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  lan ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          <label className="flex flex-col gap-2 py-4">
            <span className="text-sm text-[#1D1D1F]">管理员口令</span>
            <span className="flex gap-2">
              <input
                value={adminToken}
                onChange={(event) => setAdminToken(event.target.value)}
                className="h-9 flex-1 rounded-lg border border-[#E5E5E7] px-3 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setAdminToken(randomToken())}
                className="h-9 px-3 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F]"
              >
                生成
              </button>
            </span>
          </label>
        </div>

        {status?.embedStarted && entry && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-[#30D158]">管理端运行中</span>
            <button
              type="button"
              className="inline-flex items-center text-[#0A84FF]"
              onClick={() => window.api.system.openInAppBrowser(entry, '网络管理')}
            >
              <Wifi className="w-3.5 h-3.5 mr-1" />
              打开 {entry}
            </button>
          </div>
        )}

        <div className="mt-8 pt-2 border-t border-[#E5E5E7]">
          <p className="text-sm font-medium text-[#1D1D1F] mb-1">把这台电脑注册为客户端</p>
          <p className="text-xs text-[#A1A1A6] mb-3">
            单机可以签发一把本机密钥。集群里的其它电脑填写同一台管理端的地址，以及在网页里签发的各自密钥。
          </p>
          <div className="divide-y divide-[#E5E5E7]">
            <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-[#1D1D1F]">注册到管理端</p>
              <button
                type="button"
                aria-pressed={nodeEnabled}
                onClick={() => setNodeEnabled(!nodeEnabled)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                  nodeEnabled ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    nodeEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            <label className="flex flex-col gap-2 py-4">
              <span className="text-sm text-[#1D1D1F]">管理端地址</span>
              <input
                value={nodeUrl}
                onChange={(event) => setNodeUrl(event.target.value)}
                placeholder="http://127.0.0.1:38600"
                className="h-9 rounded-lg border border-[#E5E5E7] px-3 text-sm"
              />
            </label>
            <label className="flex flex-col gap-2 py-4">
              <span className="text-sm text-[#1D1D1F]">API Key</span>
              <input
                value={nodeKey}
                onChange={(event) => setNodeKey(event.target.value)}
                type="password"
                className="h-9 rounded-lg border border-[#E5E5E7] px-3 text-sm font-mono"
              />
            </label>
            <label className="flex flex-col gap-2 py-4">
              <span className="text-sm text-[#1D1D1F]">在列表里显示的名称</span>
              <input
                value={nodeName}
                onChange={(event) => setNodeName(event.target.value)}
                placeholder="例如：客厅电脑"
                className="h-9 rounded-lg border border-[#E5E5E7] px-3 text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-[#86868B]">节点状态：{agentLabel(status)}</p>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={handleIssue}
            disabled={!loaded || issuing || saving}
            className="h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] disabled:opacity-50"
          >
            {issuing ? '签发中…' : '签发本机密钥并连接'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!loaded || saving}
            className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] disabled:opacity-50 inline-flex items-center"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            保存网络管理设置
          </button>
        </div>
      </div>
    </Section>
  )
}
