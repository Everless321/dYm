import { describe, expect, it } from 'vitest'
import { parseBilibiliInput } from './parse'

describe('parseBilibiliInput', () => {
  it('解析 UP 主空间和投稿页', () => {
    expect(parseBilibiliInput('https://space.bilibili.com/8047632')).toEqual({
      kind: 'user',
      mid: 8047632
    })
    expect(parseBilibiliInput('https://space.bilibili.com/8047632/upload/video')).toEqual({
      kind: 'user',
      mid: 8047632
    })
    expect(parseBilibiliInput('https://m.bilibili.com/space/8047632')).toEqual({
      kind: 'user',
      mid: 8047632
    })
    expect(parseBilibiliInput('uid:42')).toEqual({ kind: 'user', mid: 42 })
  })

  it('解析视频、分 P 和纯 BV', () => {
    expect(parseBilibiliInput('https://www.bilibili.com/video/BV1xx411c7mD/?p=3')).toEqual({
      kind: 'video',
      bvid: 'BV1xx411c7mD',
      page: 3
    })
    expect(parseBilibiliInput('https://www.bilibili.com/video/av170001')).toEqual({
      kind: 'video',
      aid: 170001,
      page: 1
    })
    expect(parseBilibiliInput('BV1xx411c7mD')).toEqual({
      kind: 'video',
      bvid: 'BV1xx411c7mD',
      page: 1
    })
  })

  it('不把番剧或收藏页当成创作者', () => {
    expect(parseBilibiliInput('https://www.bilibili.com/bangumi/play/ep123')).toEqual({
      kind: 'unknown'
    })
    expect(parseBilibiliInput('https://space.bilibili.com/8047632/favlist')).toEqual({
      kind: 'unknown'
    })
  })
})
