import type { PlannedObject } from './keys'

export type SizedPlan = PlannedObject & { size: number }

export type PruneSelection =
  | { ok: true; files: string[]; bytes: number }
  | { ok: false; reason: string }

/**
 * 决定一条作品本地哪些文件可以删：只删「本地、post_objects 记录、桶」三方大小都一致的文件，
 * 任何一个对不上整条都不删（宁可多占空间也不能丢文件）。封面始终留在本地，保证列表秒开。
 * 目录里不在上传计划内的文件（desc.txt、第二张封面等）一律不碰。
 */
export function selectPrunableFiles(
  plan: readonly SizedPlan[],
  recorded: ReadonlyMap<string, number>,
  remote: ReadonlyMap<string, number>
): PruneSelection {
  const media = plan.filter((o) => o.kind !== 'cover')
  for (const o of media) {
    if (recorded.get(o.key) !== o.size) {
      return { ok: false, reason: `${o.key} 与上传记录大小不一致（本地 ${o.size}）` }
    }
    const inBucket = remote.get(o.key)
    if (inBucket === undefined) return { ok: false, reason: `${o.key} 在桶里不存在` }
    if (inBucket !== o.size) {
      return { ok: false, reason: `${o.key} 桶里大小 ${inBucket} 与本地 ${o.size} 不一致` }
    }
  }
  return {
    ok: true,
    files: media.map((o) => o.file),
    bytes: media.reduce((sum, o) => sum + o.size, 0)
  }
}

/** 核对：post_objects 记录的每个对象，在桶的完整清单里是否存在且大小一致 */
export function diffCloudObjects(
  rows: readonly { key: string; aweme_id: string; size: number }[],
  remote: ReadonlyMap<string, number>
): { checkedObjects: number; broken: Map<string, string> } {
  const broken = new Map<string, string>()
  for (const row of rows) {
    if (broken.has(row.aweme_id)) continue
    const inBucket = remote.get(row.key)
    if (inBucket === undefined) broken.set(row.aweme_id, `${row.key} 在桶里不存在`)
    else if (inBucket !== row.size) {
      broken.set(row.aweme_id, `${row.key} 大小不一致：记录 ${row.size}，桶里 ${inBucket}`)
    }
  }
  return { checkedObjects: rows.length, broken }
}
