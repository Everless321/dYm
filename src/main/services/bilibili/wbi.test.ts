import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { encodeWbi, mixinKey } from './wbi'

const IMG = '7cd084941338484aae1ad9425b84077c'
const SUB = '4932caff0ff746eab6f01bf08b70ac45'

describe('encodeWbi', () => {
  it('mixin 结果与 downkyi 的重排表一致', () => {
    expect(mixinKey(IMG + SUB)).toBe('ea1db124af3c7062474693fa704f4ff8')
  })

  it('签名不包含 w_rid，并过滤保留字符', () => {
    const signed = encodeWbi({ mid: 1, keyword: "a!'()*b", pn: 1 }, IMG, SUB, 1700000000)
    expect(signed.keyword).toBe('ab')
    expect(signed.wts).toBe('1700000000')
    expect(Object.keys(signed).at(-1)).toBe('w_rid')
    const query = ['keyword=ab', 'mid=1', 'pn=1', 'wts=1700000000'].join('&')
    const expected = createHash('md5')
      .update(query + mixinKey(IMG + SUB))
      .digest('hex')
    expect(signed.w_rid).toBe(expected)
  })
})
