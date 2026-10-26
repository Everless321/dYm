import { BrowserWindow } from 'electron'
import {
  createUser,
  getPostByAwemeId,
  getSetting,
  getUserBySecUid,
  updateUser,
  updateUserSettings,
  type DbUser
} from '../../database'
import { downloadAvatar } from '../users/avatar'
import { emitUserAdded } from '../scripts/emit'
import {
  bilibiliSecUid,
  sanitizeAddCreatorOptions,
  type AddCreatorOptions
} from '../../../shared/platforms'
import { validate as validateCronExpression } from 'node-cron'
import type { AddUserPostDownload, AddUserResult } from '../users/add'
import {
  bilibiliCookie,
  bilibiliHeaders,
  fetchCreatorProfile,
  fetchVideoDetail,
  resolveBilibiliAddress
} from './client'
import { PREVIEW_ONLY_MESSAGE, downloadBilibiliCreator } from './download'
import { parseBilibiliInput } from './parse'

export async function addBilibiliCreator(
  rawUrl: string,
  rawOptions?: unknown
): Promise<AddUserResult> {
  const options = sanitizeAddCreatorOptions(rawOptions)
  assertCron(options)
  if (!bilibiliCookie()) throw new Error('请先在系统设置里配置哔哩哔哩 Cookie')

  const resolved = await resolveBilibiliAddress(rawUrl)
  const parsed = parseBilibiliInput(resolved)
  if (parsed.kind === 'unknown') {
    throw new Error('无法识别的哔哩哔哩链接，请使用 UP 主空间或视频链接')
  }

  const detail = parsed.kind === 'video' ? await fetchVideoDetail(parsed) : null
  const mid = parsed.kind === 'user' ? parsed.mid : detail?.ownerMid || 0
  if (!mid) throw new Error('作品详情中未找到 UP 主')

  const profile = await fetchCreatorProfile(mid)
  if (!profile.name) throw new Error('哔哩哔哩未返回该 UP 主的资料，请检查 Cookie 是否有效')

  const secUid = bilibiliSecUid(profile.mid)
  const existing = getUserBySecUid(secUid)
  let user: DbUser
  let isNewUser = false
  if (existing) {
    user = existing
  } else {
    user = createUser({
      sec_uid: secUid,
      uid: String(profile.mid),
      nickname: profile.name,
      signature: profile.sign,
      avatar: profile.face,
      unique_id: String(profile.mid),
      short_id: String(profile.mid),
      following_count: profile.following,
      follower_count: profile.follower,
      aweme_count: profile.videoCount,
      homepage_url: `https://space.bilibili.com/${profile.mid}`,
      platform: 'bilibili',
      platform_settings: JSON.stringify(options?.platform_settings ?? {})
    })
    isNewUser = true
    emitUserAdded(user)
    if (profile.face) {
      const avatarPath = await downloadAvatar(
        secUid,
        profile.face,
        bilibiliHeaders(user.homepage_url)
      )
      if (avatarPath) user = updateUser(user.id, { avatar_path: avatarPath }) ?? user
    }
    user = applyNewCreatorSettings(user, options) ?? user
  }

  let postDownload: AddUserPostDownload = { status: 'not-video-link' }
  if (detail) {
    const enabled = getSetting('download_post_on_add_user') !== 'false'
    if (!enabled) {
      postDownload = { status: 'disabled' }
    } else if (getPostByAwemeId(detail.bvid)) {
      postDownload = { status: 'already-downloaded', awemeId: detail.bvid }
    } else {
      postDownload = { status: 'downloading', awemeId: detail.bvid }
      const target = user
      const page = parsed.kind === 'video' ? parsed.page : 1
      void downloadBilibiliCreator(target, {
        limit: 1,
        concurrency: 1,
        isAborted: () => false,
        onlyBvids: [detail.bvid],
        page,
        source: 'single'
      })
        .then((result) => {
          const payload = { awemeId: detail.bvid, nickname: target.nickname }
          if (result.downloaded > 0) broadcast({ ...payload, status: 'success' })
          else if (result.skipped > 0) broadcast({ ...payload, status: 'already-downloaded' })
          else if (result.locked > 0) {
            broadcast({ ...payload, status: 'failed', error: PREVIEW_ONLY_MESSAGE })
          } else broadcast({ ...payload, status: 'failed', error: '下载失败' })
        })
        .catch((error: Error) =>
          broadcast({
            awemeId: detail.bvid,
            nickname: target.nickname,
            status: 'failed',
            error: error.message
          })
        )
    }
  }

  return { user, isNewUser, postDownload }
}

function applyNewCreatorSettings(
  user: DbUser,
  options: AddCreatorOptions | undefined
): DbUser | undefined {
  if (!options) return user
  return (
    updateUserSettings(user.id, {
      max_download_count: options.max_download_count,
      show_in_home: options.show_in_home,
      auto_sync: options.auto_sync,
      sync_cron: options.sync_cron,
      live_record: false,
      live_check_cron: '',
      platform_settings: options.platform_settings
    }) ?? user
  )
}

function assertCron(options: AddCreatorOptions | undefined): void {
  if (options?.sync_cron && !validateCronExpression(options.sync_cron)) {
    throw new Error('同步计划不是合法的 Cron 表达式')
  }
}

function broadcast(payload: {
  awemeId: string
  nickname: string
  status: 'success' | 'failed' | 'already-downloaded'
  error?: string
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('user:addPostProgress', payload)
  }
}
