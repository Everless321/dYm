import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let enabled = 'true'
vi.mock('../../database', () => ({ getSetting: () => enabled }))

const { extractVideoId, withOriginalVideo } = await import('./jingxuan')

const AWEME_ID = '7698713386716113060'
const VIDEO_ID = 'v0d00fg10000dbbl3tvog65nratsk2l0'
const ORIGINAL = 'https://v5-ali-northeast.douyinvod.com/xxx/video/tos/cn/original/'

// 精选页的真实形态：video_model 是转义过的 JSON 字符串；前面放一个推荐作品的 video_id 干扰
const PAGE =
  `{"gid":"1","video_model":"{\\"video_id\\":\\"v0d00other\\"}"}` +
  `{"gid":"${AWEME_ID}","video_model":"{\\"status\\":10,\\"version\\":3,\\"video_id\\":\\"${VIDEO_ID}\\",\\"enable_ssl\\":true}"}`

const fetchMock = vi.fn()

function page(html: string, status = 200): Response {
  return new Response(html, { status })
}
function redirect(location: string | null, status = 302): Response {
  return new Response(null, { status, headers: location ? { location } : {} })
}

describe('extractVideoId', () => {
  it('取本作品 video_model 里的 video_id，不取其他作品的', () => {
    expect(extractVideoId(PAGE, AWEME_ID)).toBe(VIDEO_ID)
  })

  it('页面里没有本作品（图集、不可见）返回 null', () => {
    expect(extractVideoId('<html>图集页</html>', AWEME_ID)).toBeNull()
  })
})

describe('withOriginalVideo', () => {
  const awemeData = { awemeId: AWEME_ID, awemeType: 0, videoPlayAddr: 'https://cdn/bit_rate0' }

  beforeEach(() => {
    enabled = 'true'
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('精选页 → play 302：换成原画地址，不改原数据', async () => {
    fetchMock.mockResolvedValueOnce(page(PAGE)).mockResolvedValueOnce(redirect(ORIGINAL))
    const result = await withOriginalVideo(awemeData)
    expect(result).toEqual({ ...awemeData, videoPlayAddr: [ORIGINAL] })
    expect(awemeData.videoPlayAddr).toBe('https://cdn/bit_rate0')
    expect(fetchMock.mock.calls[1][0]).toContain(`video_id=${VIDEO_ID}`)
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: 'manual' })
  })

  it('开关关闭：不发请求，原样返回', async () => {
    enabled = 'false'
    expect(await withOriginalVideo(awemeData)).toBe(awemeData)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('图集：不发请求，原样返回', async () => {
    const images = { ...awemeData, awemeType: 68 }
    expect(await withOriginalVideo(images)).toBe(images)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('精选页没有 video_id：回退原数据', async () => {
    fetchMock.mockResolvedValueOnce(page('<html></html>'))
    expect(await withOriginalVideo(awemeData)).toBe(awemeData)
  })

  it('play 接口不是 302：回退原数据', async () => {
    fetchMock.mockResolvedValueOnce(page(PAGE)).mockResolvedValueOnce(redirect(null, 200))
    expect(await withOriginalVideo(awemeData)).toBe(awemeData)
  })

  it('网络错误（如代理拦截 TLS）：回退原数据，不抛错', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await withOriginalVideo(awemeData)).toBe(awemeData)
  })
})
