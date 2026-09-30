import { describe, expect, it } from 'vitest'
import { syncPostObjects, type ObjectStore, type LocalObject } from './sync-post'

function local(key: string, size: number): LocalObject {
  return {
    key,
    kind: 'image',
    idx: 0,
    contentType: 'image/jpeg',
    path: `/tmp/${key}`,
    size
  }
}

/** 内存版对象存储；failPuts 指定前几次 put 失败，用来测重试 */
interface FakeStore {
  store: ObjectStore
  objects: Map<string, number>
  puts: { key: string; attempt: number }[]
}

function fakeStore(initial: Record<string, number> = {}, failPuts = 0): FakeStore {
  const objects = new Map(Object.entries(initial))
  const puts: { key: string; attempt: number }[] = []
  let failures = failPuts
  const store: ObjectStore = {
    async head(key) {
      return objects.get(key) ?? null
    },
    async put(obj, attempt) {
      puts.push({ key: obj.key, attempt })
      if (failures > 0) {
        failures--
        throw new Error('502 Bad Gateway')
      }
      objects.set(obj.key, obj.size)
    }
  }
  return { store, objects, puts }
}

const noSleep = async (): Promise<void> => {}

describe('syncPostObjects', () => {
  it('桶里已有同大小对象时直接认领，不重传', async () => {
    const { store, puts } = fakeStore({ a: 100 })
    const result = await syncPostObjects([local('a', 100)], store, noSleep)
    expect(puts).toEqual([])
    expect(result).toEqual([
      { key: 'a', kind: 'image', idx: 0, size: 100, content_type: 'image/jpeg' }
    ])
  })

  it('不存在或大小不同的对象会上传', async () => {
    const { store, puts } = fakeStore({ b: 5 })
    await syncPostObjects([local('a', 100), local('b', 200)], store, noSleep)
    expect(puts.map((p) => p.key)).toEqual(['a', 'b'])
  })

  it('上传失败按次数重试，attempt 从 1 递增（决定走中转还是直传）', async () => {
    const { store, puts } = fakeStore({}, 2)
    await syncPostObjects([local('a', 100)], store, noSleep)
    expect(puts.map((p) => p.attempt)).toEqual([1, 2, 3])
  })

  it('三次都失败抛出最后的错误', async () => {
    const { store } = fakeStore({}, 3)
    await expect(syncPostObjects([local('a', 100)], store, noSleep)).rejects.toThrow('502')
  })

  it('上传后 HEAD 大小对不上视为失败，不记成功', async () => {
    const store: ObjectStore = {
      head: async (key) => (key === 'a' ? 99 : null),
      put: async () => {}
    }
    await expect(syncPostObjects([local('a', 100)], store, noSleep)).rejects.toThrow(/大小不一致/)
  })
})
