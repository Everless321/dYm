import { describe, expect, it, vi } from 'vitest'
import { ensureFreshGrokCredential, parseGrokCredential } from './grok-auth'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

describe('parseGrokCredential', () => {
  it('解析库里存的凭据 JSON', () => {
    const raw = JSON.stringify({
      access_token: 'a',
      refresh_token: 'r',
      email: 'u@x.ai',
      expires_at: 100
    })
    expect(parseGrokCredential(raw)).toEqual({
      access_token: 'a',
      refresh_token: 'r',
      id_token: undefined,
      email: 'u@x.ai',
      expires_at: 100
    })
  })

  it('缺令牌、空值或不是 JSON 时返回 null', () => {
    expect(parseGrokCredential(null)).toBeNull()
    expect(parseGrokCredential('')).toBeNull()
    expect(parseGrokCredential('not json')).toBeNull()
    expect(parseGrokCredential(JSON.stringify({ access_token: 'a' }))).toBeNull()
  })
})

describe('ensureFreshGrokCredential', () => {
  it('离过期还远时直接用原凭据，不刷新', async () => {
    const cred = {
      access_token: 'a',
      refresh_token: 'r',
      email: null,
      expires_at: Math.floor(Date.now() / 1000) + 3600
    }
    const persist = vi.fn()
    await expect(ensureFreshGrokCredential(cred, persist)).resolves.toBe(cred)
    expect(persist).not.toHaveBeenCalled()
  })

  it('快过期时用 refresh_token 换新令牌并回写', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }))
      )
    vi.stubGlobal('fetch', fetchMock)
    const persist = vi.fn()
    const next = await ensureFreshGrokCredential(
      { access_token: 'a', refresh_token: 'r', email: 'u@x.ai', expires_at: 0 },
      persist
    )
    expect(next).toMatchObject({ access_token: 'a2', refresh_token: 'r2', email: 'u@x.ai' })
    expect(persist).toHaveBeenCalledWith(next)
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('r')
    vi.unstubAllGlobals()
  })
})
