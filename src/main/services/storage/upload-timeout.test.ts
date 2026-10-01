import { describe, expect, it } from 'vitest'
import { uploadTimeoutMs } from './client'

describe('uploadTimeoutMs', () => {
  it('小文件至少给 2 分钟', () => {
    expect(uploadTimeoutMs(1024)).toBe(120_000)
  })

  it('大文件按 100 KB/s 兜底估算，并且必须是整数（AbortSignal.timeout 不接受小数）', () => {
    // 309458974 字节 / 100 = 3094589.74，修复前就是这个值导致上传直接抛错
    const ms = uploadTimeoutMs(309_458_974)
    expect(Number.isInteger(ms)).toBe(true)
    expect(ms).toBe(3_094_590)
    expect(() => AbortSignal.timeout(ms)).not.toThrow()
  })
})
