import type { ScriptApi, ScriptModule } from '../types'

/**
 * 依次同步所有用户，每人成功后把该用户的下载上限设为 10。
 *
 * 注意：同步本身走各用户当前的下载上限（用户级 >0 时优先，否则用全局设置），
 * 本脚本不会临时放开限制。想先拉全量，需要在运行前把上限清成 0。
 * 同步失败的用户不改上限，重跑脚本时按原上限重试。
 */

/** 用户之间的等待区间（毫秒）——按风控松紧调整这两个值 */
const DELAY_MIN_MS = 30 * 1000
const DELAY_MAX_MS = 60 * 1000

/** 同步成功后写入的用户级下载上限 */
const MAX_DOWNLOAD_COUNT = 10

/** 整体超时：用户多时全流程会很长，给 6 小时 */
const TIMEOUT_MS = 6 * 60 * 60 * 1000

function randomDelay(): number {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1))
}

const script: ScriptModule = {
  meta: {
    name: '依次同步全部用户并限流',
    description: `按顺序同步每个用户，成功后把该用户下载上限设为 ${MAX_DOWNLOAD_COUNT}，用户之间随机延迟避免风控`,
    timeout: TIMEOUT_MS
  },

  async run(api: ScriptApi) {
    const users = api.db.users.list() as unknown as {
      id: number
      nickname: string
      max_download_count: number
    }[]

    if (users.length === 0) {
      api.log('没有任何用户，脚本结束。')
      return { total: 0, succeeded: 0, failed: 0 }
    }

    const delaySeconds = `${DELAY_MIN_MS / 1000}~${DELAY_MAX_MS / 1000}`
    api.log(`共 ${users.length} 个用户，将依次同步，用户之间随机等待 ${delaySeconds} 秒。`)

    const succeeded: string[] = []
    const failed: { nickname: string; error: string }[] = []

    for (const [index, user] of users.entries()) {
      // 点「停止」后不再开始下一个用户；等待中的延迟由 api.sleep 立即中断
      api.throwIfCancelled()

      const position = `[${index + 1}/${users.length}]`
      api.log(`${position} 开始同步 ${user.nickname}（当前上限 ${user.max_download_count}）…`)

      try {
        await api.actions.syncUser(user.id)
        api.db.users.updateSettings(user.id, { max_download_count: MAX_DOWNLOAD_COUNT })
        succeeded.push(user.nickname)
        api.log(`${position} ✔ ${user.nickname} 同步完成，下载上限已设为 ${MAX_DOWNLOAD_COUNT}`)
      } catch (error) {
        // 停止不算同步失败：直接向上抛出终止整个脚本，不记进失败列表
        if (api.cancelled) throw error
        const message = (error as Error).message || String(error)
        failed.push({ nickname: user.nickname, error: message })
        api.log(`${position} ✖ ${user.nickname} 同步失败：${message}（保持原上限不变）`)
      }

      // 最后一个用户之后无需再等
      if (index < users.length - 1) {
        const wait = randomDelay()
        api.log(`${position} 等待 ${Math.round(wait / 1000)} 秒后继续…`)
        await api.sleep(wait)
      }
    }

    api.log('———')
    api.log(`全部结束：成功 ${succeeded.length} 个，失败 ${failed.length} 个。`)
    if (failed.length > 0) {
      api.log('失败列表：')
      failed.forEach((item) => api.log(`  ${item.nickname} — ${item.error}`))
    }

    return {
      total: users.length,
      succeeded: succeeded.length,
      failed: failed.length,
      failedUsers: failed
    }
  }
}

export default script
