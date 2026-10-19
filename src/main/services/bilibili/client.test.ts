import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
vi.mock('../../database', () => ({ getSetting: () => '' }))

// 节流状态是模块级的，每个用例重新加载一份
async function loadClient(): Promise<typeof import('./client')> {
  vi.resetModules()
  return import('./client')
}

describe('withApiThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('并发请求排队执行，两次之间至少隔 3 秒', async () => {
    const { withApiThrottle } = await loadClient()
    const startedAt: number[] = []
    const task = async (): Promise<void> => {
      startedAt.push(Date.now())
    }

    const all = Promise.all([withApiThrottle(task), withApiThrottle(task), withApiThrottle(task)])
    await vi.runAllTimersAsync()
    await all

    expect(startedAt).toHaveLength(3)
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(3000)
    expect(startedAt[2] - startedAt[1]).toBeGreaterThanOrEqual(3000)
  })

  it('一个请求失败不影响后面排队的请求', async () => {
    const { withApiThrottle } = await loadClient()
    const failed = withApiThrottle(async () => {
      throw new Error('boom')
    })
    const next = withApiThrottle(async () => 'ok')
    const settled = Promise.allSettled([failed, next])
    await vi.runAllTimersAsync()
    const [first, second] = await settled

    expect(first.status).toBe('rejected')
    expect(second).toEqual({ status: 'fulfilled', value: 'ok' })
  })

  it('HTTP 412 触发风控后，冷却期内的请求直接失败，不再发出', async () => {
    const { biliData, BilibiliRiskControlError } = await loadClient()
    const { net } = await import('electron')
    const fetchMock = vi.mocked(net.fetch)
    fetchMock.mockResolvedValue(new Response('', { status: 412 }))

    const first = biliData('https://api.bilibili.com/x/test').catch((error: Error) => error)
    await vi.runAllTimersAsync()
    expect(await first).toBeInstanceOf(BilibiliRiskControlError)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = biliData('https://api.bilibili.com/x/test').catch((error: Error) => error)
    await vi.runAllTimersAsync()
    const error = (await second) as Error
    expect(error).toBeInstanceOf(BilibiliRiskControlError)
    expect(error.message).toContain('冷却中')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('接口返回 -352 也按风控处理', async () => {
    const { biliData, BilibiliRiskControlError } = await loadClient()
    const { net } = await import('electron')
    vi.mocked(net.fetch).mockResolvedValue(
      new Response(JSON.stringify({ code: -352, message: '风控校验失败' }), { status: 200 })
    )

    const result = biliData('https://api.bilibili.com/x/test').catch((error: Error) => error)
    await vi.runAllTimersAsync()
    expect(await result).toBeInstanceOf(BilibiliRiskControlError)
  })
})
