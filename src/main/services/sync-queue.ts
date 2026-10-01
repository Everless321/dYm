/**
 * 定时同步的全局队列。
 *
 * 每个作者各自注册 cron 时，同一个整点表达式（如每小时 0 分）会让几十上百个同步同时开跑，
 * 对抖音就是一瞬间的请求洪峰，极易触发风控。这里把到点的作者放进同一个队列，
 * 按并发数逐个执行，每个跑完后再等一个带 ±50% 抖动的间隔，把请求摊平到整个周期里。
 * 已在排队或正在同步的作者不会重复入队，所以周期比一轮耗时短也不会越积越多。
 */

export interface SyncQueueOptions {
  /** 同时最多跑几个（每次调度时读取，改设置立即生效） */
  concurrency: () => number
  /** 一个跑完后，到同一槽位开下一个之前的基础间隔 */
  gapMs: () => number
  run: (userId: number) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class SyncQueue {
  private readonly pending: number[] = []
  private readonly active = new Set<number>()
  private slots = 0

  constructor(private readonly options: SyncQueueOptions) {}

  /** 入队；已在排队或正在同步返回 false */
  enqueue(userId: number): boolean {
    if (this.active.has(userId) || this.pending.includes(userId)) return false
    this.pending.push(userId)
    this.pump()
    return true
  }

  get pendingCount(): number {
    return this.pending.length
  }

  isActive(userId: number): boolean {
    return this.active.has(userId)
  }

  /** 清空排队（停止调度时用），正在跑的不打断 */
  clear(): void {
    this.pending.length = 0
  }

  private pump(): void {
    while (this.slots < Math.max(1, this.options.concurrency()) && this.pending.length > 0) {
      const userId = this.pending.shift()!
      this.slots++
      void this.runSlot(userId)
    }
  }

  private async runSlot(userId: number): Promise<void> {
    this.active.add(userId)
    try {
      await this.options.run(userId)
    } catch (error) {
      console.error(`[SyncQueue] 用户 ${userId} 同步出错:`, (error as Error).message)
    } finally {
      this.active.delete(userId)
    }
    if (this.pending.length > 0) {
      const random = (this.options.random ?? Math.random)()
      const gap = Math.max(0, this.options.gapMs()) * (0.5 + random)
      await (this.options.sleep ?? defaultSleep)(Math.round(gap))
    }
    this.slots--
    this.pump()
  }
}
