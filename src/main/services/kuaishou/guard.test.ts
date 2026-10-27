import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  API_GAP_MS,
  KuaishouCooldownError,
  markKuaishouQuota,
  QUOTA_COOLDOWN_MS,
  resetKuaishouGuardForTests,
  waitKuaishouCooldown,
  withKuaishouApiThrottle,
  withKuaishouDownloadThrottle
} from './guard'

describe('快手请求排队与冷却', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    resetKuaishouGuardForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('接口请求排队执行，两次之间至少隔 5 秒', async () => {
    const startedAt: number[] = []
    const task = async (): Promise<void> => {
      startedAt.push(Date.now())
    }
    const all = Promise.all([withKuaishouApiThrottle(task), withKuaishouApiThrottle(task)])
    await vi.runAllTimersAsync()
    await all
    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(API_GAP_MS)
  })

  it('限额后冷却期内的接口请求直接失败，不再执行', async () => {
    const first = withKuaishouApiThrottle(async () => markKuaishouQuota()).catch(
      (error: Error) => error
    )
    await vi.runAllTimersAsync()
    expect(await first).toBeInstanceOf(KuaishouCooldownError)

    let ran = false
    const second = withKuaishouApiThrottle(async () => {
      ran = true
    }).catch((error: Error) => error)
    await vi.runAllTimersAsync()
    const error = (await second) as Error
    expect(error).toBeInstanceOf(KuaishouCooldownError)
    expect(error.message).toContain('冷却中')
    expect(ran).toBe(false)
  })

  it('等待冷却：冷却结束后才返回', async () => {
    try {
      markKuaishouQuota()
    } catch {
      // 标记限流本身就会抛出
    }
    let done = false
    const waiting = waitKuaishouCooldown(() => false).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(QUOTA_COOLDOWN_MS - 1000)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1000)
    await waiting
    expect(done).toBe(true)
  })

  it('限额只拦接口，已经列出的作品仍可以下载', async () => {
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
  })
})
