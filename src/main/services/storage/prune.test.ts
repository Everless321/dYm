import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let folder: string | null
const recorded = new Map<string, number>()
const markCloudOnly = vi.fn()

vi.mock('../media', () => ({ resolvePostFolder: () => folder }))
vi.mock('../../database', () => ({
  getPostObjects: () => [...recorded].map(([key, size]) => ({ key, size })),
  markPostCloudOnly: (id: string) => markCloudOnly(id),
  listPruneCandidates: () => []
}))
vi.mock('./client', () => ({ headObject: vi.fn() }))

const { prunePost } = await import('./prune')

const ID = '7000000000000000001'
const post = { aweme_id: ID, sec_uid: 'SEC', folder_name: ID }
const base = `creators/SEC/posts/${ID}`
const config = {} as never

function makeFolder(files: Record<string, number>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dym-prune-'))
  for (const [name, size] of Object.entries(files))
    writeFileSync(join(dir, name), Buffer.alloc(size))
  return dir
}

beforeEach(() => {
  recorded.clear()
  markCloudOnly.mockReset()
})

describe('prunePost', () => {
  const files = {
    [`${ID}_cover.webp`]: 3,
    [`${ID}_video.mp4`]: 100,
    [`${ID}_music.mp3`]: 7,
    [`${ID}_desc.txt`]: 2
  }
  const all = new Map([
    [`${base}/cover.jpg`, 3],
    [`${base}/video.mp4`, 100],
    [`${base}/music.mp3`, 7]
  ])

  it('三方一致：删掉视频和原声，留下封面和不在计划内的文件，标记 cloud_only', async () => {
    folder = makeFolder(files)
    all.forEach((v, k) => recorded.set(k, v))
    expect(await prunePost(config, post, all)).toEqual({ ok: true, bytes: 107 })
    expect(readdirSync(folder).sort()).toEqual([`${ID}_cover.webp`, `${ID}_desc.txt`])
    expect(markCloudOnly).toHaveBeenCalledWith(ID)
  })

  it('dry-run 只算不删', async () => {
    folder = makeFolder(files)
    all.forEach((v, k) => recorded.set(k, v))
    expect(await prunePost(config, post, all, true)).toEqual({ ok: true, bytes: 107 })
    expect(readdirSync(folder)).toHaveLength(4)
    expect(markCloudOnly).not.toHaveBeenCalled()
  })

  it('桶里缺一个对象：一个文件都不删，状态不变', async () => {
    folder = makeFolder(files)
    all.forEach((v, k) => recorded.set(k, v))
    const remote = new Map(all)
    remote.delete(`${base}/music.mp3`)
    expect(await prunePost(config, post, remote)).toMatchObject({ ok: false })
    expect(existsSync(join(folder, `${ID}_video.mp4`))).toBe(true)
    expect(markCloudOnly).not.toHaveBeenCalled()
  })

  it('本地目录不在：直接标记 cloud_only', async () => {
    folder = null
    expect(await prunePost(config, post, all)).toEqual({ ok: true, bytes: 0 })
    expect(markCloudOnly).toHaveBeenCalledWith(ID)
  })
})
