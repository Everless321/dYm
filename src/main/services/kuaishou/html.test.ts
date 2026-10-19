import { describe, expect, it } from 'vitest'
import { extractKuaishouPageDetail } from './html'

const APOLLO = `<html><script>window.__APOLLO_STATE__={"defaultClient":{"VisionVideoDetailPhoto:3xphoto":{"caption":"标题","coverUrl":"https://cdn/c.jpg","photoUrl":"https://cdn/v.mp4","duration":1500,"timestamp":1700000000000,"realLikeCount":8,"viewCount":20},"VisionVideoDetailAuthor:3xuser":{"id":"3xuser","name":"作者"}}};(function(){var s;(s=document.currentScript||document.scripts[document.scripts.length-1]).parentNode.removeChild(s);}());</script></html>`

describe('extractKuaishouPageDetail', () => {
  it('读取网页 Apollo 里的作品和作者', () => {
    expect(extractKuaishouPageDetail(APOLLO, '3xphoto', true)).toEqual({
      photoId: '3xphoto',
      caption: '标题',
      coverUrl: 'https://cdn/c.jpg',
      photoUrl: 'https://cdn/v.mp4',
      authorId: '3xuser',
      authorName: '作者',
      timestampMs: 1700000000000,
      durationMs: 1500,
      likeCount: 8,
      viewCount: 20
    })
  })

  it('没有内嵌数据时返回空', () => {
    expect(extractKuaishouPageDetail('<html></html>', '3xphoto', true)).toBeNull()
  })
})
