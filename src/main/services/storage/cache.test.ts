import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'http'
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const userData = mkdtempSync(join(tmpdir(), 'dym-cache-'))
let objects: {
  key: string
  kind: string
  idx: number
  size: number
  content_type: string | null
}[] = []
/** 按作品指定云端对象；没指定的用 objects */
const objectsById = new Map<string, typeof objects>()
let cacheBytes = 1024 ** 3
let port = 0
const hits: string[] = []

vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../media', () => ({ resolvePostFolder: () => null }))
vi.mock('../../database', () => ({
  getPostObjects: (id: string) => objectsById.get(id) ?? objects
}))
vi.mock('./config', () => ({ loadStorageConfig: () => ({ cacheBytes }) }))
vi.mock('./client', () => ({
  remoteObjectUrl: (_config: unknown, key: string) => `http://127.0.0.1:${port}/${key}`
}))

const { ensureLocalMedia, resolveMediaFolder } = await import('./cache')

let server: Server
beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url!)
    // 模拟大文件：slow 开头的 key 晚一点才返回
    const delay = req.url!.startsWith('/slow/') ? 300 : 0
    setTimeout(() => res.end(`body:${req.url}`), delay)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as { port: number }).port
})
afterAll(() => server.close())
beforeEach(() => {
  hits.length = 0
  cacheBytes = 1024 ** 3
  objectsById.clear()
})

const post = (id: string): { aweme_id: string; sec_uid: string; folder_name: string } => ({
  aweme_id: id,
  sec_uid: 'SEC',
  folder_name: id
})

describe('ensureLocalMedia', () => {
  it('本地已清理时从桶里取回，文件名沿用 polydl 命名，第二次直接命中缓存', async () => {
    const id = '7000000000000000001'
    const base = `creators/SEC/posts/${id}`
    objects = [
      { key: `${base}/images/0.jpg`, kind: 'image', idx: 0, size: 1, content_type: 'image/webp' },
      { key: `${base}/images/1.jpg`, kind: 'image', idx: 1, size: 1, content_type: null },
      { key: `${base}/live/1.mp4`, kind: 'live', idx: 1, size: 1, content_type: null }
    ]
    const dir = await ensureLocalMedia(post(id))
    expect(readdirSync(dir!).sort()).toEqual([
      '.complete',
      `${id}_image_1.webp`,
      `${id}_image_2.jpg`,
      `${id}_live_2.mp4`
    ])
    expect(readFileSync(join(dir!, `${id}_image_2.jpg`), 'utf8')).toBe(`body:/${base}/images/1.jpg`)
    expect(resolveMediaFolder('SEC', id, id)).toBe(dir)

    hits.length = 0
    expect(await ensureLocalMedia(post(id))).toBe(dir)
    expect(hits).toEqual([])
  })

  it('没有云端记录时返回本地目录（这里为 null），不去下载', async () => {
    objects = []
    expect(await ensureLocalMedia(post('7000000000000000002'))).toBeNull()
    expect(hits).toEqual([])
  })

  it('超过缓存上限按最近使用淘汰，刚取回的不会被淘汰', async () => {
    const first = '7000000000000000003'
    objects = [{ key: `k/${first}`, kind: 'video', idx: 0, size: 1, content_type: null }]
    const firstDir = (await ensureLocalMedia(post(first)))!
    // 把第一条的「最近使用」拨到很久以前
    utimesSync(join(firstDir, '.complete'), new Date(0), new Date(0))

    cacheBytes = 1
    const second = '7000000000000000004'
    objects = [{ key: `k/${second}`, kind: 'video', idx: 0, size: 1, content_type: null }]
    const secondDir = (await ensureLocalMedia(post(second)))!
    expect(existsSync(secondDir)).toBe(true)
    expect(existsSync(firstDir)).toBe(false)
  })

  it('并发取回时，先完成的作品清理缓存不会删掉别的作品没下完的目录', async () => {
    const slow = '7000000000000000005'
    const fast = '7000000000000000006'
    objectsById.set(slow, [
      { key: `slow/${slow}`, kind: 'video', idx: 0, size: 1, content_type: null }
    ])
    objectsById.set(fast, [
      { key: `fast/${fast}`, kind: 'video', idx: 0, size: 1, content_type: null }
    ])
    const [slowDir, fastDir] = await Promise.all([
      ensureLocalMedia(post(slow)),
      ensureLocalMedia(post(fast))
    ])
    expect(readdirSync(slowDir!)).toContain(`${slow}_video.mp4`)
    expect(readdirSync(fastDir!)).toContain(`${fast}_video.mp4`)
  })

  it('同一作品并发取回只下载一次', async () => {
    const id = '7000000000000000007'
    objectsById.set(id, [{ key: `slow/${id}`, kind: 'video', idx: 0, size: 1, content_type: null }])
    const [a, b] = await Promise.all([ensureLocalMedia(post(id)), ensureLocalMedia(post(id))])
    expect(a).toBe(b)
    expect(hits).toEqual([`/slow/${id}`])
  })
})
