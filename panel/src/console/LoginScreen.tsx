'use client'

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import { errorMessage } from './format'
import { BrandMark } from './icons'

export function LoginScreen({ onSuccess }: { onSuccess: () => void }): React.JSX.Element {
  const [token, setToken] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    document.title = '登录 · dYm 管理控制台'
  }, [])

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ token }) })
      onSuccess()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <section className="login-aside">
          <div className="login-aside-inner">
            <div className="brand-lockup">
              <BrandMark />
              <span>dYm</span>
            </div>
            <h1>管理控制台</h1>
            <p className="login-lead">
              查看并操作已经注册的客户端。进入一台之后，作品、用户和下载任务都只属于这一台。
            </p>
            <ul className="login-points">
              <li>客户端填写地址和密钥后主动连入</li>
              <li>抖音登录只在对应电脑的 dYm 窗口里完成</li>
              <li>管理员口令与节点密钥分开保管</li>
            </ul>
          </div>
        </section>
        <section className="login-main">
          <form id="loginForm" onSubmit={(event) => void onSubmit(event)}>
            <p className="eyebrow">管理员</p>
            <h2>登录</h2>
            <p className="lede">使用这台管理端的口令。这不是节点密钥。</p>
            <div className="field">
              <label htmlFor="tokenInput">口令</label>
              <div className="secret">
                <input
                  id="tokenInput"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  spellCheck={false}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoFocus
                />
                <button
                  id="toggleToken"
                  type="button"
                  onClick={() => {
                    setVisible((current) => !current)
                  }}
                >
                  {visible ? '隐藏' : '显示'}
                </button>
              </div>
            </div>
            <p id="loginError" className="error" hidden={!error}>
              {error}
            </p>
            <button className="primary block" type="submit" disabled={pending}>
              进入控制台
            </button>
          </form>
          <p className="login-foot">口令不会下发到客户端。</p>
        </section>
      </div>
    </div>
  )
}
