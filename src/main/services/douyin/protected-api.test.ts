import { beforeEach, describe, expect, it, vi } from 'vitest'

let cookie = 'sessionid=s1'
vi.mock('../../database', () => ({ getSetting: () => cookie }))

const fetchGuarded = vi.fn()
vi.mock('./page', () => ({ fetchGuarded: (...args: unknown[]) => fetchGuarded(...args) }))

// polydl 的直连请求：按调用顺序给出响应
const direct = vi.fn()
vi.mock('polydl', () => ({
  getDevice: () => ({}),
  webRequestParamsOf: () => ({}),
  DouyinCrawler: class {
    model2Endpoint = async (base: string): Promise<string> => base
    fetchGetJson = async (): Promise<unknown> => direct()
    fetchPostJson = async (): Promise<unknown> => direct()
  }
}))

const { fetchProtected } = await import('./protected-api')

describe('fetchProtected', () => {
  beforeEach(() => {
    // 每个用例换一个会话，不受上一个用例记住的路线影响
    cookie = `sessionid=${Math.random()}`
    direct.mockReset()
    fetchGuarded.mockReset().mockResolvedValue({ status_code: 0, from: 'page' })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('直连拿到 JSON 就直接返回，不开页面', async () => {
    direct.mockResolvedValue({ status: 200, data: { status_code: 0, from: 'direct' } })
    expect(await fetchProtected('/aweme/v1/web/collects/list/')).toMatchObject({ from: 'direct' })
    expect(fetchGuarded).not.toHaveBeenCalled()
  })

  it('直连被拦（非 JSON）：退回页面，本会话之后不再试直连', async () => {
    direct.mockResolvedValue({ status: 403, data: 'Blocked by ArgusSecurityPlugin' })
    expect(await fetchProtected('/a/')).toMatchObject({ from: 'page' })
    expect(await fetchProtected('/b/')).toMatchObject({ from: 'page' })
    expect(direct).toHaveBeenCalledTimes(1)
    expect(fetchGuarded).toHaveBeenCalledTimes(2)
  })

  it('直连请求抛错（空响应重试失败）：退回页面', async () => {
    direct.mockRejectedValue(new Error('响应数据为空字符串'))
    expect(await fetchProtected('/a/', {}, 'POST', { action: 0 })).toMatchObject({ from: 'page' })
    expect(fetchGuarded).toHaveBeenCalledWith('/a/', {}, 'POST', { action: 0 })
  })

  it('直连返回 status_code 非 0（如「用户未登录」）：也退回页面，以页面结果为准', async () => {
    direct.mockResolvedValue({ status: 200, data: { status_code: 8, status_msg: '用户未登录' } })
    expect(await fetchProtected('/a/')).toMatchObject({ from: 'page' })
  })

  it('页面也失败：抛出页面的错误', async () => {
    direct.mockResolvedValue({ status: 200, data: { status_code: 8 } })
    fetchGuarded.mockRejectedValue(new Error('抖音页面未发出可取样的请求'))
    await expect(fetchProtected('/a/')).rejects.toThrow('抖音页面未发出可取样的请求')
    // 页面失败不记住走页面，下次仍先试直连
    direct.mockResolvedValue({ status: 200, data: { status_code: 0, from: 'direct' } })
    expect(await fetchProtected('/a/')).toMatchObject({ from: 'direct' })
  })

  it('换了登录会话：重新从直连试起', async () => {
    direct.mockResolvedValueOnce({ status: 403, data: '' })
    await fetchProtected('/a/')
    cookie = 'sessionid=another'
    direct.mockResolvedValueOnce({ status: 200, data: { status_code: 0, from: 'direct' } })
    expect(await fetchProtected('/a/')).toMatchObject({ from: 'direct' })
  })
})
