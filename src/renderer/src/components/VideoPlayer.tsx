import { useEffect, useRef } from 'react'
import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'

interface VideoPlayerProps {
  /** 视频地址（本项目里是 local://file 前缀的本地路径） */
  url: string
  poster?: string
  className?: string
}

/** 西瓜播放器（xgplayer，字节跳动开源）封装 */
export function VideoPlayer({ url, poster, className }: VideoPlayerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !url) return
    const player = new Player({
      el: containerRef.current,
      url,
      poster,
      lang: 'zh-cn',
      // 该组件只在用户点击后挂载，必然有用户手势，所以不需要 autoplayMuted 兜底
      //（加了会无条件静音，比原来的 <video autoPlay> 退步）
      autoplay: true,
      height: '100%',
      width: '100%',
      // 竖屏视频为主：容器尺寸固定，视频等比缩放放进去
      fitVideoSize: 'fixed',
      videoFillMode: 'contain',
      playbackRate: [0.5, 1, 1.5, 2, 3],
      // 下载交给应用自己的「打开文件夹」，播放器里不重复提供
      download: false,
      pip: true,
      rotate: true,
      screenShot: false
    })
    return () => player.destroy()
  }, [url, poster])

  return <div ref={containerRef} className={className} />
}
