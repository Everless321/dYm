import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#F5F5F7',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif'
        }}
      >
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 16,
            padding: '40px 48px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            maxWidth: 420
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: '#FFF2F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}
          >
            <span style={{ fontSize: 24 }}>!</span>
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: '#1D1D1F', margin: '0 0 8px' }}>
            页面出现异常
          </h2>
          <p style={{ fontSize: 13, color: '#6E6E73', margin: '0 0 24px', lineHeight: 1.5 }}>
            {this.state.error?.message || '发生了未知错误'}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 36,
              padding: '0 20px',
              borderRadius: 8,
              border: 'none',
              background: '#0A84FF',
              color: '#FFFFFF',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            <RotateCcw size={14} />
            重试
          </button>
        </div>
      </div>
    )
  }
}
