import { describe, expect, it } from 'vitest'
import { diffCloudObjects, selectPrunableFiles, type SizedPlan } from './prune-plan'

const plan = (key: string, kind: SizedPlan['kind'], size: number, file = key): SizedPlan => ({
  file,
  key,
  kind,
  idx: 0,
  contentType: 'x',
  size
})

describe('selectPrunableFiles', () => {
  const files = [
    plan('c', 'cover', 10, 'c.jpg'),
    plan('v', 'video', 100, 'v.mp4'),
    plan('m', 'music', 5, 'm.mp3')
  ]
  const all = new Map([
    ['c', 10],
    ['v', 100],
    ['m', 5]
  ])

  it('本地、数据库、桶三方大小一致时，删除除封面以外的已上传文件', () => {
    expect(selectPrunableFiles(files, all, all)).toEqual({
      ok: true,
      files: ['v.mp4', 'm.mp3'],
      bytes: 105
    })
  })

  it('桶里缺任何一个对象就整条不删', () => {
    const remote = new Map([
      ['c', 10],
      ['v', 100]
    ])
    expect(selectPrunableFiles(files, all, remote)).toMatchObject({ ok: false })
  })

  it('桶里大小与本地不一致就整条不删（可能传了一半）', () => {
    const remote = new Map([...all, ['v', 99]])
    const result = selectPrunableFiles(files, all, remote)
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.reason).toMatch(/v/)
  })

  it('数据库记录的大小与本地不一致（上传后本地又被改过）就不删', () => {
    const rows = new Map([...all, ['m', 6]])
    expect(selectPrunableFiles(files, rows, all)).toMatchObject({ ok: false })
  })

  it('封面缺失不影响删除其他文件（封面本来就留在本地）', () => {
    const remote = new Map([
      ['v', 100],
      ['m', 5]
    ])
    const rows = new Map(remote)
    expect(selectPrunableFiles(files, rows, remote)).toMatchObject({
      ok: true,
      files: ['v.mp4', 'm.mp3']
    })
  })

  it('只有封面的目录（已经清理过）没有可删的', () => {
    expect(selectPrunableFiles([files[0]], all, all)).toEqual({ ok: true, files: [], bytes: 0 })
  })
})

describe('diffCloudObjects', () => {
  it('找出桶里缺失或大小不一致的作品', () => {
    const rows = [
      { key: 'a/1', aweme_id: 'A', size: 1 },
      { key: 'a/2', aweme_id: 'A', size: 2 },
      { key: 'b/1', aweme_id: 'B', size: 3 },
      { key: 'c/1', aweme_id: 'C', size: 4 }
    ]
    const remote = new Map([
      ['a/1', 1],
      ['a/2', 2],
      ['b/1', 30]
    ])
    expect(diffCloudObjects(rows, remote)).toEqual({
      checkedObjects: 4,
      broken: new Map([
        ['B', 'b/1 大小不一致：记录 3，桶里 30'],
        ['C', 'c/1 在桶里不存在']
      ])
    })
  })
})
