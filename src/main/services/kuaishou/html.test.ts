import { describe, expect, it } from 'vitest'
import { classifyPageMedia, extractKuaishouPageDetail } from './html'

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
      viewCount: 20,
      musicUrl: '',
      imageUrls: []
    })
  })

  it('读出配乐和图集地址', () => {
    const html = `<html><script>window.INIT_STATE = ${JSON.stringify({
      photo: {
        photoId: 'atlas1',
        caption: '图',
        coverUrls: [{ url: 'https://cdn/c.jpg' }],
        userEid: '3xuser',
        userName: '作者',
        timestamp: 1,
        music: { audioUrls: [{ url: 'https://cdn/m.m4a' }] },
        ext_params: { atlas: { cdn: ['tx.a.yximgs.com'], list: ['/a.jpg', '/b.jpg'] } }
      }
    })};</script></html>`
    const detail = extractKuaishouPageDetail(html, 'atlas1', false)
    expect(detail?.musicUrl).toBe('https://cdn/m.m4a')
    expect(detail?.imageUrls).toEqual([
      'https://tx.a.yximgs.com/a.jpg',
      'https://tx.a.yximgs.com/b.jpg'
    ])
  })

  it('单张图集也算图文', () => {
    expect(classifyPageMedia(1)).toBe('images')
    expect(classifyPageMedia(0)).toBe('video')
  })

  it('没有内嵌数据时返回空', () => {
    expect(extractKuaishouPageDetail('<html></html>', '3xphoto', true)).toBeNull()
  })
})
