import { useState } from 'react'
import { Github, Send } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './ui/dialog'
import { Button } from './ui/button'

const TELEGRAM_URL = 'https://t.me/+a02Yk5OY4gk1N2I1'
const GITHUB_URL = 'https://github.com/Everless321/dYm'
const DISMISS_KEY = 'dym-welcome-dismissed'

export function WelcomeDialog() {
  const [open, setOpen] = useState(() => localStorage.getItem(DISMISS_KEY) !== '1')

  const openExternal = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const dismissForever = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>欢迎使用 dYm</DialogTitle>
          <DialogDescription className="pt-1">
            AI 驱动的抖音视频分析与下载管理工具
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-relaxed text-[#3A3A3C]">
          <p>
            dYm 是一款<strong className="font-semibold text-[#1D1D1F]">完全免费的开源软件</strong>
            ，无需付费、没有内购、没有订阅、没有任何功能限制。
          </p>
          <p>如果有人以本软件的名义向你收取任何费用，均与作者无关，请注意甄别、谨防上当。</p>
          <p>
            项目在 GitHub 完全开源，欢迎 Star、提 Issue
            或参与贡献；使用中遇到问题、想反馈需求，也可以加入官方 Telegram
            交流群，我们在群里解答问题、发布更新。
          </p>
        </div>

        <p className="text-xs leading-relaxed text-[#A1A1A6]">
          本软件会收集匿名使用统计（如启动次数、版本、系统类型）以帮助改进产品，不含任何个人信息或下载内容，可在「系统设置」中关闭。
        </p>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button variant="outline" onClick={() => openExternal(GITHUB_URL)}>
            <Github className="h-4 w-4" />
            GitHub 开源仓库
          </Button>
          <Button variant="outline" onClick={() => openExternal(TELEGRAM_URL)}>
            <Send className="h-4 w-4" />
            Telegram 交流群
          </Button>
        </div>

        <DialogFooter className="gap-2 sm:justify-between sm:gap-2">
          <Button variant="ghost" className="text-[#8E8E93]" onClick={dismissForever}>
            不再提醒
          </Button>
          <Button onClick={() => setOpen(false)}>我知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
