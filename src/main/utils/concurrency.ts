export interface RunWithConcurrencyOptions<T> {
  /** 每个任务结束（成功或失败）时回调，index 对应 tasks 下标 */
  onComplete?: (index: number, result: T | Error) => void
  /** 返回 true 时不再领取新任务；已在跑的任务会自然结束 */
  shouldStop?: () => boolean
}

/**
 * 固定 worker 数的任务池。
 *
 * 单个任务抛错不会让整个池子失败：错误会作为结果原样放回对应下标，
 * 由调用方决定怎么处理。这样一个用户下载失败不会中断其他用户。
 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  options: RunWithConcurrencyOptions<T> = {}
): Promise<(T | Error)[]> {
  const results: (T | Error)[] = new Array(tasks.length)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      if (options.shouldStop?.()) break
      const index = nextIndex++
      try {
        const result = await tasks[index]()
        results[index] = result
        options.onComplete?.(index, result)
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        results[index] = err
        options.onComplete?.(index, err)
      }
    }
  }

  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, tasks.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
