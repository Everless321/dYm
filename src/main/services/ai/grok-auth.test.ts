import { describe, expect, it } from 'vitest'
import { parseGrokCliToken } from './grok-auth'

describe('parseGrokCliToken', () => {
  it('取浏览器登录条目里的 key', () => {
    const raw = JSON.stringify({ 'https://accounts.x.ai/sign-in': { key: ' token-abc ' } })
    expect(parseGrokCliToken(raw)).toBe('token-abc')
  })

  it('没有登录条目、key 为空或不是字符串时返回 null', () => {
    expect(parseGrokCliToken(JSON.stringify({}))).toBeNull()
    expect(parseGrokCliToken(JSON.stringify({ 'https://accounts.x.ai/sign-in': {} }))).toBeNull()
    expect(
      parseGrokCliToken(JSON.stringify({ 'https://accounts.x.ai/sign-in': { key: '  ' } }))
    ).toBeNull()
    expect(
      parseGrokCliToken(JSON.stringify({ 'https://accounts.x.ai/sign-in': { key: 1 } }))
    ).toBeNull()
  })

  it('不是合法 JSON 对象时返回 null', () => {
    expect(parseGrokCliToken('not json')).toBeNull()
    expect(parseGrokCliToken('null')).toBeNull()
    expect(parseGrokCliToken('"str"')).toBeNull()
  })
})
