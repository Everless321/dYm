import { describe, expect, it } from 'vitest'
import { pageFromFeed, workFromFeedItem } from './feed'
import { mediaExtension } from './files'

describe('workFromFeedItem', () => {
  it('视频作品取 mp4Url，图文作品拼图集地址', () => {
    expect(
      workFromFeedItem({
        mp4Url: 'https://cdn/v.mp4',
        counts: { fanCount: 10, followCount: 2, photoCount: 30 },
        photo: {
          photoType: 'VIDEO',
          caption: '一条视频',
          timestamp: 1700000000000,
          userName: '作者',
          userEid: '3xuser',
          share_info: 'userId=3xuser&photoId=3xphoto',
          coverUrls: [{ url: 'https://cdn/c.jpg' }],
          headUrls: [{ url: 'https://cdn/a.jpg' }],
          likeCount: 4,
          viewCount: 9,
          soundTrack: { audioUrls: [{ url: 'https://cdn/m.m4a' }] }
        }
      })
    ).toMatchObject({
      photoId: '3xphoto',
      photoType: 'video',
      downloadUrls: ['https://cdn/v.mp4'],
      musicUrl: 'https://cdn/m.m4a',
      authorId: '3xuser',
      fanCount: 10,
      photoCount: 30
    })

    expect(
      workFromFeedItem({
        atlas: { cdn: ['tx.a.yximgs.com'], list: ['/a.jpg', '/b.jpg'] },
        photo: { photoType: 'VERTICAL_ATLAS', photoId: 'atlas1', userEid: 'u' }
      })?.downloadUrls
    ).toEqual(['https://tx.a.yximgs.com/a.jpg', 'https://tx.a.yximgs.com/b.jpg'])
  })
})

describe('pageFromFeed', () => {
  it('pcursor 为 no_more 时结束翻页', () => {
    const page = pageFromFeed({
      feeds: [{ photo: { photoId: 'p1', photoType: 'VIDEO' }, mp4Url: 'https://cdn/v.mp4' }],
      pcursor: 'no_more'
    })
    expect(page.works).toHaveLength(1)
    expect(page.finished).toBe(true)
  })
})

describe('mediaExtension', () => {
  it('识别 jpeg 和 mp4 的 ftyp', () => {
    expect(mediaExtension(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    const mp4 = new Uint8Array(16)
    mp4.set([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 4)
    expect(mediaExtension(mp4)).toBe('mp4')
  })
})
