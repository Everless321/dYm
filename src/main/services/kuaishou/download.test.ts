import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ROOT = join(tmpdir(), 'dym-kuaishou-download-test')
const settings: Record<string, string> = {}
const existing = new Set<string>()
const createPost = vi.fn()

vi.mock('../../database', () => ({
  getSetting: (key: string) => settings[key] ?? '',
  getPostByAwemeId: (id: string) => (existing.has(id) ? { aweme_id: id } : undefined),
  createPost: (...args: unknown[]) => createPost(...args)
}))
vi.mock('../media', () => ({ getDownloadPath: () => ROOT }))
vi.mock('../scripts/emit', () => ({ emitPostDownloaded: vi.fn() }))
vi.mock('./guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./guard')>()),
  withKuaishouDownloadThrottle: <T>(task: () => Promise<T>) => task()
}))

// 投稿按 12 个一页，从新到旧编号 w0 起
const TOTAL = 30
const fetchKuaishouFeedPage = vi.fn()
vi.mock('./client', () => ({
  fetchKuaishouFeedPage: (...args: unknown[]) => fetchKuaishouFeedPage(...args)
}))

// 下载器只在临时目录里造文件，按 polydl 的文件名返回结果
const downloadWork = vi.fn()
vi.mock('polydl', () => ({
  KuaishouDownloader: class {
    downloadWork = (...args: unknown[]): unknown => downloadWork(...args)
  }
}))

const { KuaishouCooldownError } = await import('./guard')
const { downloadKuaishouCreator, downloadKuaishouWork } = await import('./download')

const work = (index: number, overrides: object = {}): Record<string, unknown> => ({
  workId: `w${index}`,
  workType: 'video',
  caption: '',
  desc: '',
  createTime: '',
  ...overrides
})
const page = (cursor: string): unknown => {
  const start = cursor ? Number(cursor) : 0
  const works = Array.from({ length: 12 }, (_, i) => start + i)
    .filter((i) => i < TOTAL)
    .map((i) => work(i))
  const next = start + 12 < TOTAL ? String(start + 12) : 'no_more'
  return { works, pcursor: next, finished: next === 'no_more' }
}
const creator = { id: 1, uid: 'u1', nickname: 'up', sec_uid: 'ks_u1' } as never

function fakeDownload(item: { workId: string; workType: string }, dir: string): unknown[] {
  const folder = join(dir, item.workId)
  mkdirSync(folder, { recursive: true })
  const file = (name: string): string => {
    writeFileSync(join(folder, name), 'x')
    return join(folder, name)
  }
  const cover = { kind: 'cover', success: true, filePath: file('cover.jpg') }
  if (item.workType === 'image') {
    return [
      cover,
      { kind: 'image', index: 0, success: true, filePath: file('image_0.jpg') },
      { kind: 'image', index: 1, success: true, filePath: file('image_1.webp') }
    ]
  }
  return [cover, { kind: 'video', success: true, filePath: file('video.mp4') }]
}

async function plan(limit: number): Promise<{ pending: number; pages: number }> {
  let pending = -1
  await downloadKuaishouCreator(creator, {
    limit,
    concurrency: 1,
    isAborted: () => false,
    onProgress: (event) => {
      if (event.message.startsWith('准备下载') || event.message.includes('没有新的投稿')) {
        pending = event.total
      }
    }
  })
  return { pending, pages: fetchKuaishouFeedPage.mock.calls.length }
}

describe('downloadKuaishouCreator', () => {
  beforeEach(() => {
    for (const key of Object.keys(settings)) delete settings[key]
    existing.clear()
    createPost.mockClear()
    fetchKuaishouFeedPage.mockReset().mockImplementation(async (_uid, cursor) => page(cursor))
    downloadWork.mockReset().mockImplementation(async (item, dir) => fakeDownload(item, dir))
    rmSync(ROOT, { recursive: true, force: true })
  })

  it('默认只看最新 N 个：最新 5 个都已下载时不再往旧的翻', async () => {
    for (let i = 0; i < 5; i++) existing.add(`ks_w${i}`)
    expect(await plan(5)).toEqual({ pending: 0, pages: 1 })
  })

  it('补齐模式：跳过已下载的，凑够 N 个未下载的', async () => {
    settings.download_limit_mode = 'backfill'
    for (let i = 0; i < 14; i++) existing.add(`ks_w${i}`)
    expect(await plan(5)).toEqual({ pending: 5, pages: 2 })
  })

  it('不限数量时翻完全部', async () => {
    expect(await plan(0)).toEqual({ pending: TOTAL, pages: 3 })
  })

  it('翻页中途限额：已列出的作品照常下完，并说明为什么没翻完', async () => {
    fetchKuaishouFeedPage
      .mockReset()
      .mockResolvedValueOnce(page(''))
      .mockRejectedValueOnce(new KuaishouCooldownError('投稿接口到了条数限额'))
    const result = await downloadKuaishouCreator(creator, {
      limit: 0,
      concurrency: 1,
      isAborted: () => false
    })
    expect(result.downloaded).toBe(12)
    expect(result.notice).toContain('限额')
  })

  it('第一页就失败（未登录）：直接抛错', async () => {
    fetchKuaishouFeedPage.mockReset().mockRejectedValue(new Error('快手未登录'))
    await expect(
      downloadKuaishouCreator(creator, { limit: 0, concurrency: 1, isAborted: () => false })
    ).rejects.toThrow('快手未登录')
  })
})

describe('downloadKuaishouWork', () => {
  beforeEach(() => {
    existing.clear()
    createPost.mockClear()
    downloadWork.mockReset().mockImplementation(async (item, dir) => fakeDownload(item, dir))
    rmSync(ROOT, { recursive: true, force: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('视频改名成 <id>_video / <id>_cover，并按视频入库', async () => {
    expect(await downloadKuaishouWork(creator, work(1) as never, 'single')).toBe(true)
    expect(readdirSync(join(ROOT, 'ks_u1', 'w1')).sort()).toEqual(['w1_cover.jpg', 'w1_video.mp4'])
    expect(createPost).toHaveBeenCalledWith(
      expect.objectContaining({ aweme_id: 'ks_w1', aweme_type: 0, folder_name: 'w1' })
    )
  })

  it('图集改名成 <id>_image_<从 1 起>，并按图文入库', async () => {
    expect(
      await downloadKuaishouWork(creator, work(2, { workType: 'image' }) as never, 'single')
    ).toBe(true)
    expect(readdirSync(join(ROOT, 'ks_u1', 'w2')).sort()).toEqual([
      'w2_cover.jpg',
      'w2_image_1.jpg',
      'w2_image_2.webp'
    ])
    expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ aweme_type: 68 }))
  })

  it('媒体文件下载失败：删掉目录，不入库', async () => {
    downloadWork.mockImplementation(async (item: { workId: string }, dir: string) => {
      mkdirSync(join(dir, item.workId), { recursive: true })
      return [{ kind: 'video', success: false, error: 'HTTP 403' }]
    })
    expect(await downloadKuaishouWork(creator, work(3) as never, 'single')).toBe(false)
    expect(readdirSync(join(ROOT, 'ks_u1'))).toEqual([])
    expect(createPost).not.toHaveBeenCalled()
  })
})
