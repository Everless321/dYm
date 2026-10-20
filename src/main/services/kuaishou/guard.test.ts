import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  API_GAP_MS,
  DOWNLOAD_GAP_MS,
  KuaishouQuotaError,
  feedSignInput,
  interpretKuaishouResult,
  markKuaishouQuota,
  resetKuaishouGuardForTests,
  signedFeedUrl,
  withKuaishouApiThrottle,
  withKuaishouDownloadThrottle
} from './guard'

describe('interpretKuaishouResult', () => {
  it('区分限额、签名失败和正常列表', () => {
    expect(interpretKuaishouResult({ result: 2, error_msg: '操作太快了' })).toEqual({
      kind: 'quota'
    })
    expect(interpretKuaishouResult({ result: 50, error_msg: '签名验证失败' })).toEqual({
      kind: 'unsigned'
    })
    expect(interpretKuaishouResult({ result: 1, feeds: [] })).toEqual({ kind: 'ok' })
    expect(interpretKuaishouResult({ result: 11, error_msg: '用户不存在' }).kind).toBe('error')
  })
})

describe('feed signature contract', () => {
  it('把 $encode 的入参和带 __NS_hxfalcon 的地址固定下来', () => {
    expect(feedSignInput('3xuser', '')).toEqual({
      url: '/rest/v/profile/feed',
      query: { caver: 2 },
      form: {},
      requestBody: { user_id: '3xuser', pcursor: '', page: 'profile' }
    })
    expect(signedFeedUrl('ab c')).toBe(
      'https://www.kuaishou.com/rest/v/profile/feed?__NS_hxfalcon=ab%20c&caver=2'
    )
  })
})

describe('kuaishou throttle', () => {
  beforeEach(() => {
    resetKuaishouGuardForTests()
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('接口请求排队，两次之间至少隔开设定间隔', async () => {
    const startedAt: number[] = []
    const task = async (): Promise<void> => {
      startedAt.push(Date.now())
    }
    const all = Promise.all([
      withKuaishouApiThrottle(task),
      withKuaishouApiThrottle(task),
      withKuaishouApiThrottle(task)
    ])
    await vi.runAllTimersAsync()
    await all
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(API_GAP_MS)
    expect(startedAt[2] - startedAt[1]).toBeGreaterThanOrEqual(API_GAP_MS)
  })

  it('下载请求也排队', async () => {
    const startedAt: number[] = []
    const all = Promise.all([
      withKuaishouDownloadThrottle(async () => {
        startedAt.push(Date.now())
      }),
      withKuaishouDownloadThrottle(async () => {
        startedAt.push(Date.now())
      })
    ])
    await vi.runAllTimersAsync()
    await all
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(DOWNLOAD_GAP_MS)
  })

  it('限额冷却只拦住接口，已经列出来的文件仍可以下载', async () => {
    try {
      markKuaishouQuota()
    } catch {
      // 标记限额本身就会抛出
    }
    let ran = false
    const download = withKuaishouDownloadThrottle(async () => {
      ran = true
    })
    await vi.runAllTimersAsync()
    await download
    expect(ran).toBe(true)

    const blocked = withKuaishouApiThrottle(async () => {
      ran = false
    }).catch((error: Error) => error)
    await vi.runAllTimersAsync()
    expect(await blocked).toBeInstanceOf(KuaishouQuotaError)
    expect(ran).toBe(true)
  })

  it('触发限额后，冷却期内不再执行排队任务', async () => {
    const first = withKuaishouApiThrottle(async () => {
      markKuaishouQuota()
    }).catch((error: Error) => error)
    await vi.runAllTimersAsync()
    expect(await first).toBeInstanceOf(KuaishouQuotaError)

    let ran = false
    const second = withKuaishouApiThrottle(async () => {
      ran = true
    }).catch((error: Error) => error)
    await vi.runAllTimersAsync()
    const error = (await second) as Error
    expect(error).toBeInstanceOf(KuaishouQuotaError)
    expect(error.message).toContain('冷却')
    expect(ran).toBe(false)
  })
})
