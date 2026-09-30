import type { ObjectKind } from './keys'

/** 一个待同步的本地文件 */
export interface LocalObject {
  key: string
  kind: ObjectKind
  idx: number
  contentType: string
  path: string
  size: number
}

/** 同步成功后写进 post_objects 的一行 */
export interface SyncedObject {
  key: string
  kind: ObjectKind
  idx: number
  size: number
  /** 从桶里认领的对象不知道原始类型，为 null */
  content_type: string | null
}

export interface ObjectStore {
  /** 对象大小；不存在返回 null */
  head(key: string): Promise<number | null>
  /** attempt 从 1 开始，实现方据此决定走中转还是直传 */
  put(obj: LocalObject, attempt: number): Promise<void>
}

// 失败后的等待时长，长度决定重试次数：2 次退避 = 最多 3 次尝试（与节点 Agent 一致）
const RETRY_DELAYS_MS = [2_000, 8_000]
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function putWithRetry(
  store: ObjectStore,
  obj: LocalObject,
  sleep: (ms: number) => Promise<void>
): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await store.put(obj, attempt)
      return
    } catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAYS_MS[attempt - 1])
    }
  }
  throw lastError
}

/**
 * 逐个同步一条作品的文件：桶里已有同大小的对象直接认领（迁移时不必重传），
 * 否则上传并用 HEAD 核对大小。任何一个文件失败整条作品失败，不记录部分结果。
 */
export async function syncPostObjects(
  objects: readonly LocalObject[],
  store: ObjectStore,
  sleep: (ms: number) => Promise<void> = defaultSleep
): Promise<SyncedObject[]> {
  const synced: SyncedObject[] = []
  for (const obj of objects) {
    if ((await store.head(obj.key)) !== obj.size) {
      await putWithRetry(store, obj, sleep)
      const remote = await store.head(obj.key)
      if (remote !== obj.size) {
        throw new Error(`${obj.key} 上传后大小不一致：本地 ${obj.size}，远端 ${remote ?? '不存在'}`)
      }
    }
    synced.push({
      key: obj.key,
      kind: obj.kind,
      idx: obj.idx,
      size: obj.size,
      content_type: obj.contentType
    })
  }
  return synced
}
