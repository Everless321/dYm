import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { PoolStatus } from '../../../../shared/pool'

const inputClass = 'h-9 rounded-lg border border-[#E5E5E7] px-3 text-sm'
const primaryClass =
  'h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] disabled:opacity-50 inline-flex items-center'
const secondaryClass =
  'h-9 px-3 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] disabled:opacity-50'

function Switch({
  on,
  disabled,
  onClick
}: {
  on: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export function PoolSettingsCard(): React.JSX.Element {
  const [status, setStatus] = useState<PoolStatus | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.pool
      .status()
      .then((s) => {
        setStatus(s)
        if (s.email) setEmail(s.email)
      })
      .catch((error) => toast.error(`读取共享计划状态失败: ${(error as Error).message}`))
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const run = async (action: () => Promise<PoolStatus | void>, success?: string): Promise<void> => {
    setBusy(true)
    try {
      const next = await action()
      if (next) setStatus(next)
      if (success) toast.success(success)
    } catch (error) {
      // IPC 抛出的错误带 "Error invoking remote method ..." 前缀，只留原因
      toast.error(
        (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      )
    } finally {
      setBusy(false)
    }
  }

  const sendCode = (): Promise<void> =>
    run(async () => {
      await window.api.pool.sendCode(email)
      setCooldown(60)
    }, '验证码已发送，请查收邮件（也看看垃圾箱）')

  const submit = (): Promise<void> =>
    run(
      async () => {
        const next =
          mode === 'register'
            ? await window.api.pool.register(email, password, code)
            : await window.api.pool.login(email, password)
        setPassword('')
        setCode('')
        return next
      },
      mode === 'register' ? '注册成功，已加入共享计划' : '登录成功，已加入共享计划'
    )

  return (
    <div className="flex flex-col">
      <div className="text-xs text-[#86868B] leading-relaxed space-y-1 mb-4">
        <p>加入后，dYm 用户一起分担抖音的请求，单个账号就不容易被风控。</p>
        <p>· 下载作品前先查共享池。池里有就从池里下，每个作品扣 1 分；自己传的、下过的不再扣。</p>
        <p>
          · 从抖音下载的作品自动上传到共享池。第一个上传的人得 5 分。单个文件超过 90MB
          的作品不上传。
        </p>
        <p>· 作者资料和作品列表只上传，不从共享池读取。</p>
        <p>· 注册不送额度，先上传作品才能从池里下载。</p>
      </div>

      {status?.loggedIn ? (
        <div className="divide-y divide-[#E5E5E7]">
          <div className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm text-[#1D1D1F]">加入共享计划</p>
              <p className="text-xs text-[#86868B] mt-0.5">关闭后不上传也不从共享池下载</p>
            </div>
            <Switch
              on={status.enabled}
              disabled={busy}
              onClick={() => run(() => window.api.pool.setEnabled(!status.enabled))}
            />
          </div>
          <div className="flex items-center justify-between py-4 text-sm">
            <span className="text-[#1D1D1F]">账号</span>
            <span className="text-[#86868B]">{status.email}</span>
          </div>
          <div className="flex items-center justify-between py-4 text-sm">
            <span className="text-[#1D1D1F]">额度 / 已上传作品</span>
            <span className="text-[#86868B]">
              {status.credits ?? '—'} 分 / {status.uploads ?? '—'} 个
            </span>
          </div>
          {status.error && <p className="py-3 text-xs text-[#FF3B30]">{status.error}</p>}
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              disabled={busy}
              className={secondaryClass}
              onClick={() => run(() => window.api.pool.status())}
            >
              刷新
            </button>
            <button
              type="button"
              disabled={busy}
              className={secondaryClass}
              onClick={() => run(() => window.api.pool.logout(), '已退出登录，并退出共享计划')}
            >
              退出登录
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {status?.error && <p className="text-xs text-[#FF3B30]">{status.error}</p>}
          <div className="flex gap-4 text-sm">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={mode === m ? 'text-[#0A84FF] font-medium' : 'text-[#86868B]'}
              >
                {m === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            type="email"
            autoComplete="email"
            className={inputClass}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? '设置密码（至少 8 位）' : '密码'}
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            className={inputClass}
          />
          {mode === 'register' && (
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="邮箱验证码"
                inputMode="numeric"
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                disabled={busy || cooldown > 0 || !email}
                onClick={sendCode}
                className={secondaryClass}
              >
                {cooldown > 0 ? `${cooldown} 秒后重发` : '发送验证码'}
              </button>
            </div>
          )}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={busy || !email || !password || (mode === 'register' && !code)}
              onClick={submit}
              className={primaryClass}
            >
              {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              {mode === 'register' ? '注册并加入' : '登录并加入'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
