/**
 * 滑动窗口限流：每分钟最多放行 rpm 次。
 * 与旧实现的区别：并发调用方排队按顺序领取时间片，不会在同一时刻被同时放行然后一起超限。
 */
export class RateLimiter {
  private timestamps: number[] = []
  private chain: Promise<void> = Promise.resolve()

  constructor(private rpm: number) {
    this.rpm = Math.max(1, rpm)
  }

  setRpm(rpm: number): void {
    this.rpm = Math.max(1, rpm)
  }

  wait(signal?: AbortSignal): Promise<void> {
    const next = this.chain.then(() => this.acquire(signal))
    // 链上任一环节被中止不能拖累后来者
    this.chain = next.catch(() => undefined)
    return next
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    while (true) {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted')
      const now = Date.now()
      this.timestamps = this.timestamps.filter((t) => t > now - 60_000)
      if (this.timestamps.length < this.rpm) {
        this.timestamps.push(now)
        return
      }
      const waitMs = this.timestamps[0] + 60_000 - now
      await sleep(Math.max(waitMs, 10), signal)
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
