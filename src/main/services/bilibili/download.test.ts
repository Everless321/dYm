import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings: Record<string, string> = {}
const existing = new Set<string>()

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
const createPost = vi.fn()
vi.mock('../../database', () => ({
  getSetting: (key: string) => settings[key] ?? '',
  getPostByAwemeId: (id: string) => (existing.has(id) ? { aweme_id: id } : undefined),
  createPost: (...args: unknown[]) => createPost(...args)
}))
vi.mock('../media', async () => {
  const { tmpdir } = await import('os')
  return { getDownloadPath: () => `${tmpdir()}/dym-bilibili-download-test` }
})
vi.mock('../scripts/emit', () => ({ emitPostDownloaded: vi.fn() }))
vi.mock('../../utils/ffmpeg-path', () => ({ ffmpegPath: 'ffmpeg' }))

// 投稿列表按 30 个一页，从新到旧编号 BV0000000000 起
const TOTAL = 75
const bvid = (index: number): string => `BV${String(index).padStart(10, '0')}`
const fetchPublicationPage = vi.fn(async (_mid: number, page: number) => ({
  videos: Array.from({ length: 30 }, (_, i) => (page - 1) * 30 + i)
    .filter((index) => index < TOTAL)
    .map((index) => ({ bvid: bvid(index), title: '', description: '', pic: '', created: 0 })),
  total: TOTAL,
  pageSize: 30
}))

// 默认详情一律失败，作品不会真正下载，只测挑选逻辑
const fetchVideoDetail = vi.fn()
const fetchPlayUrl = vi.fn()
vi.mock('./client', () => ({
  BilibiliRiskControlError: class extends Error {},
  bilibiliCookie: () => 'SESSDATA=x',
  bilibiliHeaders: () => ({}),
  fetchPlayUrl: (...args: unknown[]) => fetchPlayUrl(...args),
  fetchPublicationPage: (mid: number, page: number) => fetchPublicationPage(mid, page),
  fetchSubtitleTracks: vi.fn(),
  fetchVideoDetail: (...args: unknown[]) => fetchVideoDetail(...args),
  normalizeAssetUrl: (url: string) => url,
  withApiThrottle: <T>(task: () => Promise<T>) => task()
}))

const { net } = await import('electron')
const { downloadBilibiliCreator } = await import('./download')

const creator = { uid: '1', nickname: 'up', sec_uid: 'bili_1', platform_settings: '{}' } as never
const detail = (overrides: object = {}): object => ({
  bvid: bvid(0),
  title: '',
  desc: '',
  pic: '',
  pubdate: 0,
  pages: [{ cid: 1, page: 1, part: '' }],
  chargeLocked: false,
  ...overrides
})
const downloadOne = (): ReturnType<typeof downloadBilibiliCreator> =>
  downloadBilibiliCreator(creator, {
    limit: 1,
    concurrency: 1,
    isAborted: () => false,
    onlyBvids: [bvid(0)]
  })

/** 跑一次同步，返回准备下载的数量和翻了几页 */
async function plan(limit: number): Promise<{ pending: number; pages: number }> {
  let pending = -1
  await downloadBilibiliCreator(creator, {
    limit,
    concurrency: 1,
    isAborted: () => false,
    onProgress: (event) => {
      if (event.message.startsWith('准备下载') || event.message.includes('没有新的投稿')) {
        pending = event.total
      }
    }
  })
  return { pending, pages: fetchPublicationPage.mock.calls.length }
}

describe('downloadBilibiliCreator 下载数量限制', () => {
  beforeEach(() => {
    for (const key of Object.keys(settings)) delete settings[key]
    existing.clear()
    fetchPublicationPage.mockClear()
    fetchVideoDetail.mockReset().mockRejectedValue(new Error('skip'))
    // 作品详情被故意设成失败，下载失败日志是预期内的
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('默认只看最新 N 个：最新 5 个都已下载时不再往旧的翻', async () => {
    for (let i = 0; i < 5; i++) existing.add(bvid(i))
    expect(await plan(5)).toEqual({ pending: 0, pages: 1 })
  })

  it('默认只看最新 N 个：只补最新 N 个里缺的', async () => {
    existing.add(bvid(0))
    existing.add(bvid(2))
    expect(await plan(5)).toEqual({ pending: 3, pages: 1 })
  })

  it('补齐模式：跳过已下载的，凑够 N 个未下载的', async () => {
    settings.download_limit_mode = 'backfill'
    for (let i = 0; i < 32; i++) existing.add(bvid(i))
    // 前 32 个都下过，要翻到第 2 页才能凑够 5 个
    expect(await plan(5)).toEqual({ pending: 5, pages: 2 })
  })

  it('不限数量时两种方式都翻完全部', async () => {
    expect(await plan(0)).toEqual({ pending: TOTAL, pages: 3 })
  })
})

describe('downloadBilibiliCreator 只能试看的作品', () => {
  beforeEach(() => {
    existing.clear()
    createPost.mockClear()
    fetchPlayUrl.mockReset()
    vi.mocked(net.fetch).mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('充电专属且没充电：跳过，不请求播放地址，不算下载失败', async () => {
    fetchVideoDetail.mockReset().mockResolvedValue(detail({ chargeLocked: true }))
    const result = await downloadOne()
    expect(result).toMatchObject({ downloaded: 0, locked: 1 })
    expect(fetchPlayUrl).not.toHaveBeenCalled()
    expect(createPost).not.toHaveBeenCalled()
  })

  it('播放地址只有一段明显短于完整时长的 durl：按试看跳过，不下载也不入库', async () => {
    fetchVideoDetail.mockReset().mockResolvedValue(detail())
    // 实测充电专属：5 分钟的视频只给 25 秒 durl
    fetchPlayUrl.mockResolvedValue({
      timelength: 305_299,
      durl: [{ url: 'https://cdn.example/preview.mp4', length: 24_985 }]
    })
    const result = await downloadOne()
    expect(result).toMatchObject({ downloaded: 0, locked: 1 })
    expect(net.fetch).not.toHaveBeenCalled()
    expect(createPost).not.toHaveBeenCalled()
  })
})
