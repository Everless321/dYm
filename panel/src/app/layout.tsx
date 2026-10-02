import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'dYm 管理控制台',
  description: '查看并操作已经注册的客户端。进入一台之后，作品、用户和下载任务都只属于这一台。'
}

export const viewport: Viewport = {
  themeColor: '#0b1220',
  width: 'device-width',
  initialScale: 1
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
