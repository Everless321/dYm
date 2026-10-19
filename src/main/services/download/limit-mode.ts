import { getSetting } from '../../database'

/**
 * 「最大下载数量 / 单次下载限制」N 怎么算：
 * - latest（默认）：只看线上最新的 N 个作品，缺哪个补哪个，不往更旧的翻。
 *   抖音同步一直是这个行为，已有用户不受影响，也最省请求。
 * - backfill：跳过已下载的，凑够 N 个没下过的为止。每次同步都会往更旧的作品多翻 N 个。
 */
export function isBackfillLimitMode(): boolean {
  return getSetting('download_limit_mode') === 'backfill'
}
