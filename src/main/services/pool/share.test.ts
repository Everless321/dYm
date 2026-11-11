import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, truncateSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { timestamp2Str } from 'polydl'

const settings: Record<string, string> = {}
const fetchMock = vi.fn()
vi.mock('electron', () => ({ net: { fetch: (...args: unknown[]) => fetchMock(...args) } }))
vi.mock('../../database', () => ({
  getSetting: (key: string) => settings[key] ?? null,
  getUserById: () => ({ platform: 'douyin' })
}))

const {
  createTimeOf,
  downloadFromPool,
  initPoolShare,
  lookupPool,
  planShareFiles,
  sharePostList,
  POOL_MAX_FILE_BYTES
} = await import('./share')
const { appEvents } = await import('../app-events')

const ID = '7540681547180002611'

beforeEach(() => {
  Object.assign(settings, { pool_enabled: 'true', pool_token: 'tok' })
  fetchMock.mockReset()
})

function makeFolder(files: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), 'pool-'))
  for (const [name, size] of Object.entries(files))
    writeFileSync(join(dir, name), Buffer.alloc(size, 1))
  return dir
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('createTimeOf', () => {
  it('反算 polydl 的 createTime 字符串，跟本机时区无关', () => {
    for (const t of [1755793800, 1768676400, 1700000001]) {
      expect(createTimeOf(timestamp2Str(t) as string)).toBe(t)
    }
    expect(createTimeOf('bad')).toBeNull()
    expect(createTimeOf(undefined)).toBeNull()
  })
})

describe('planShareFiles', () => {
  it('本地文件名映射成共享池文件名', () => {
    const dir = makeFolder({
      [`${ID}_cover.jpg`]: 100,
      [`${ID}_video.mp4`]: 20000,
      [`${ID}_music.mp3`]: 300,
      [`${ID}_desc.txt`]: 5
    })
    expect(planShareFiles(dir, ID)?.map((f) => [f.name, f.size])).toEqual([
      ['cover.jpg', 100],
      ['video.mp4', 20000],
      ['music.mp3', 300]
    ])
  })
  it('单个文件超过 90MiB、只有封面、总量太小时都不上传', () => {
    const big = makeFolder({ [`${ID}_cover.jpg`]: 100, [`${ID}_video.mp4`]: 1 })
    truncateSync(join(big, `${ID}_video.mp4`), POOL_MAX_FILE_BYTES + 1)
    expect(planShareFiles(big, ID)).toBeNull()
    expect(planShareFiles(makeFolder({ [`${ID}_cover.jpg`]: 20000 }), ID)).toBeNull()
    expect(planShareFiles(makeFolder({ [`${ID}_video.mp4`]: 100 }), ID)).toBeNull()
  })
})

describe('downloadFromPool', () => {
  const poolFiles = [
    { name: 'video.mp4', size: 4, url: 'https://pool/v' },
    { name: 'cover.jpg', size: 2, url: 'https://pool/c' }
  ]

  it('池里有：按 polydl 命名写进作品目录，不留 .tmp', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { files: poolFiles, credits: 4 }))
      .mockResolvedValueOnce(new Response('vvvv', { headers: { 'content-type': 'video/mp4' } }))
      .mockResolvedValueOnce(new Response('cc', { headers: { 'content-type': 'image/webp' } }))
    const dir = join(mkdtempSync(join(tmpdir(), 'pool-')), ID)
    expect(await downloadFromPool(ID, dir)).toBe(true)
    expect(readdirSync(dir).sort()).toEqual([`${ID}_cover.webp`, `${ID}_video.mp4`])
    expect(readFileSync(join(dir, `${ID}_video.mp4`), 'utf8')).toBe('vvvv')
  })

  it('池里没有、大小不符、未加入共享计划：返回 false，不留文件', async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: 'not_found' }))
    const dir = join(mkdtempSync(join(tmpdir(), 'pool-')), ID)
    expect(await downloadFromPool(ID, dir)).toBe(false)

    fetchMock
      .mockResolvedValueOnce(json(200, { files: poolFiles, credits: 4 }))
      .mockResolvedValueOnce(new Response('vv'))
    expect(await downloadFromPool(ID, dir)).toBe(false)
    expect(readdirSync(dir)).toEqual([])

    settings.pool_enabled = 'false'
    expect(await downloadFromPool(ID, dir)).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('sharePostList', () => {
  it('每批最多 200 条；只有翻到底时最后一批带 fromStart/reachedEnd；不带 CDN 地址', async () => {
    fetchMock.mockImplementation(async () => json(200, { ok: true }))
    const listed = Array.from({ length: 450 }, (_, i) => ({
      awemeId: String(7540681547180002611n - BigInt(i) * 2n ** 32n),
      awemeType: 0,
      desc: `d${i}`,
      createTime: timestamp2Str(1755793800 - i) as string,
      videoPlayAddr: ['https://cdn/expiring']
    }))
    sharePostList('MS4wLjABAAAAsec', listed, true)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(bodies.map((b) => b.posts.length)).toEqual([200, 200, 50])
    expect(bodies.map((b) => [b.fromStart, b.reachedEnd])).toEqual([
      [false, false],
      [false, false],
      [true, true]
    ])
    expect(bodies[0].posts[1]).toEqual({
      itemId: listed[1].awemeId,
      createTime: 1755793800 - 1,
      awemeType: 0,
      desc: 'd1'
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://pool.hyperdevx.com/api/v1/authors/douyin/MS4wLjABAAAAsec/posts'
    )
  })
})

describe('失败重试', () => {
  beforeAll(() => initPoolShare())
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** 推进假时钟并让真实文件 IO 跑完，直到 check 成立 */
  async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 300 && !check(); i++) {
      await new Promise((r) => setImmediate(r))
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(check()).toBe(true)
  }
  const calls = (part: string): number =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes(part)).length
  const ok = (): Response => json(200, { ok: true, credits: 5 })
  const upload = (): Response =>
    json(200, {
      uploads: [{ name: 'video.mp4', method: 'PUT', url: 'https://pool/put', headers: {} }]
    })

  // 别用 ID：前面「池里有」的用例把它记成了从池里下载的，会跳过上传
  function emitDownloaded(): void {
    const id = '7540681547180009999'
    const dir = makeFolder({ [`${id}_video.mp4`]: 20000 })
    appEvents.emit('script-hook', {
      hook: 'post.downloaded',
      post: { awemeId: id, userId: 1 },
      folderPath: dir
    })
  }

  it('文件上传遇到 5xx 或网络错误：只重试这个文件，不重新申请上传', async () => {
    let puts = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/uploads/request')) return upload()
      if (url === 'https://pool/put') {
        puts++
        if (puts === 1) throw new TypeError('fetch failed')
        if (puts === 2) return json(503, { error: 'unavailable' })
        return new Response(null, { status: 200 })
      }
      return ok()
    })
    emitDownloaded()
    await until(() => calls('/uploads/complete') === 1)
    expect([calls('/uploads/request'), puts]).toEqual([1, 3])
  })

  it('最多重试 3 次；4xx 不重试', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/uploads/request')) return upload()
      if (url === 'https://pool/put') throw new TypeError('fetch failed')
      return ok()
    })
    emitDownloaded()
    await until(() => calls('https://pool/put') === 4)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(calls('https://pool/put')).toBe(4)
    expect(calls('/uploads/complete')).toBe(0)

    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/uploads/request') ? upload() : json(403, { error: 'invalid_signature' })
    )
    emitDownloaded()
    await until(() => calls('https://pool/put') === 1)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(calls('https://pool/put')).toBe(1)
  })

  it('作品列表某一批失败后重试成功，后续批次照常发', async () => {
    let n = 0
    fetchMock.mockImplementation(async () => {
      n++
      return n === 1 ? json(502, { error: 'bad_gateway' }) : ok()
    })
    const listed = Array.from({ length: 250 }, (_, i) => ({
      awemeId: String(7540681547180002611n - BigInt(i)),
      createTime: timestamp2Str(1755793800 - i) as string
    }))
    sharePostList('MS4wLjABAAAAsec', listed, true)
    await until(() => n === 3)
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(bodies.map((b) => [b.posts.length, b.reachedEnd])).toEqual([
      [200, false],
      [200, false],
      [50, true]
    ])
  })
})

describe('lookupPool', () => {
  it('分批查询，合并结果', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { itemIds } = JSON.parse(init.body as string)
      return json(200, {
        items: itemIds
          .filter((id: string) => id.endsWith('7'))
          .map((itemId: string) => ({ itemId }))
      })
    })
    const ids = Array.from({ length: 1200 }, (_, i) => String(7000000000000000000n + BigInt(i)))
    const found = await lookupPool(ids)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(found.size).toBe(120)
  })

  it('网络不通时只等一次请求，返回空集合；未加入时不发请求', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const ids = Array.from({ length: 1200 }, (_, i) => String(i))
    expect((await lookupPool(ids)).size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    settings.pool_enabled = 'false'
    expect((await lookupPool(ids)).size).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
