import { describe, expect, it } from 'vitest'
import { parseKuaishouInput } from './parse'

describe('parseKuaishouInput', () => {
  it('识别主页、作品和短链', () => {
    expect(parseKuaishouInput('https://www.kuaishou.com/profile/3xabc')).toEqual({
      kind: 'user',
      userId: '3xabc'
    })
    expect(parseKuaishouInput('https://www.kuaishou.com/short-video/3xphoto1')).toEqual({
      kind: 'work',
      photoId: '3xphoto1',
      web: true,
      userId: ''
    })
    expect(
      parseKuaishouInput('https://v.m.chenzhongtech.com/fw/photo/3x?userId=3xuser&photoId=3xphoto2')
    ).toEqual({ kind: 'work', photoId: '3xphoto2', web: false, userId: '3xuser' })
    expect(parseKuaishouInput('https://v.kuaishou.com/abcd')).toEqual({
      kind: 'short',
      url: 'https://v.kuaishou.com/abcd'
    })
    expect(parseKuaishouInput('https://www.kuaishou.com/f/shareCode')).toMatchObject({
      kind: 'short'
    })
  })

  it('不把别的平台或残缺路径当成快手创作者', () => {
    expect(parseKuaishouInput('https://www.douyin.com/user/abc')).toEqual({ kind: 'unknown' })
    expect(parseKuaishouInput('https://www.kuaishou.com/profile/')).toEqual({ kind: 'unknown' })
  })
})
