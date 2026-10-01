import { describe, expect, it } from 'vitest'
import { SyncQueue } from './sync-queue'

/** 手动推进的假时钟：记录每次 sleep 的时长，测试里按需放行 */
interface Harness {
  queue: SyncQueue
  started: number[]
  sleeps: number[]
  finish: (id: number) => Promise<void>
  wake: () => Promise<void>
  flush: () => Promise<void>
}

function harness(opts: { concurrency?: number; gapMs?: number; random?: number } = {}): Harness {
  const started: number[] = []
  const finishers = new Map<number, () => void>()
  const sleeps: number[] = []
  const wakeups: (() => void)[] = []
  const queue = new SyncQueue({
    concurrency: () => opts.concurrency ?? 1,
    gapMs: () => opts.gapMs ?? 1000,
    random: () => opts.random ?? 0.5,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        sleeps.push(ms)
        wakeups.push(resolve)
      }),
    run: (id) =>
      new Promise<void>((resolve, reject) => {
        started.push(id)
        finishers.set(id, () => resolve())
        if (id < 0) reject(new Error('boom'))
      })
  })
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  const finish = async (id: number): Promise<void> => {
    finishers.get(id)?.()
    await flush()
  }
  const wake = async (): Promise<void> => {
    wakeups.shift()?.()
    await flush()
  }
  return { queue, started, sleeps, finish, wake, flush }
}

describe('SyncQueue', () => {
  it('同一时刻到点的作者按顺序一个一个跑，不会同时开跑', async () => {
    const h = harness()
    for (const id of [1, 2, 3]) h.queue.enqueue(id)
    await h.flush()
    expect(h.started).toEqual([1])
    expect(h.queue.pendingCount).toBe(2)
  })

  it('队列空了不用等间隔', async () => {
    const h = harness()
    h.queue.enqueue(1)
    await h.flush()
    await h.finish(1)
    expect(h.sleeps).toEqual([])
  })

  it('跑完一个先等间隔再开下一个', async () => {
    const h = harness({ gapMs: 1000, random: 0.5 })
    h.queue.enqueue(1)
    h.queue.enqueue(2)
    await h.flush()
    await h.finish(1)
    expect(h.started).toEqual([1])
    expect(h.sleeps).toEqual([1000])
    await h.wake()
    expect(h.started).toEqual([1, 2])
  })

  it('间隔带 ±50% 随机抖动', async () => {
    for (const [random, expected] of [
      [0, 500],
      [0.999, 1499]
    ]) {
      const h = harness({ gapMs: 1000, random })
      h.queue.enqueue(1)
      h.queue.enqueue(2)
      await h.flush()
      await h.finish(1)
      expect(h.sleeps[0]).toBe(expected)
    }
  })

  it('已在排队或正在同步的作者不会重复入队', async () => {
    const h = harness()
    expect(h.queue.enqueue(1)).toBe(true)
    expect(h.queue.enqueue(2)).toBe(true)
    await h.flush()
    expect(h.queue.enqueue(1)).toBe(false) // 正在跑
    expect(h.queue.enqueue(2)).toBe(false) // 在排队
    expect(h.queue.pendingCount).toBe(1)
  })

  it('并发数 2 时同时最多跑 2 个', async () => {
    const h = harness({ concurrency: 2 })
    for (const id of [1, 2, 3]) h.queue.enqueue(id)
    await h.flush()
    expect(h.started).toEqual([1, 2])
  })

  it('某个作者同步出错不影响后面的', async () => {
    const h = harness({ gapMs: 0 })
    h.queue.enqueue(-1)
    h.queue.enqueue(2)
    await h.flush()
    await h.wake()
    expect(h.started).toEqual([-1, 2])
  })

  it('clear 清空排队但不打断正在跑的', async () => {
    const h = harness()
    for (const id of [1, 2, 3]) h.queue.enqueue(id)
    await h.flush()
    h.queue.clear()
    expect(h.queue.pendingCount).toBe(0)
    expect(h.queue.isActive(1)).toBe(true)
  })
})
