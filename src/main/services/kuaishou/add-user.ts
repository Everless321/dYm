import { BrowserWindow } from 'electron'
import { validate as validateCronExpression } from 'node-cron'
import type { KuaishouWork } from 'polydl'
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
  kuaishouAwemeId,
  kuaishouSecUid,
  sanitizeAddCreatorOptions
} from '../../../shared/platforms'
import type { AddUserPostDownload, AddUserResult } from '../users/add'
import { fetchKuaishouProfile, fetchKuaishouWork, resolveKuaishouTarget } from './client'
import { downloadKuaishouWork } from './download'

export async function addKuaishouCreator(
  rawUrl: string,
  rawOptions?: unknown
): Promise<AddUserResult> {
  const options = sanitizeAddCreatorOptions(rawOptions)
  if (options?.sync_cron && !validateCronExpression(options.sync_cron)) {
    throw new Error('同步计划不是合法的 Cron 表达式')
  }

  const target = await resolveKuaishouTarget(rawUrl)
  // 作品链接：先拿详情，作者 ID 从详情里取
  const work = target.kind === 'photo' ? await fetchKuaishouWork(target.id) : null
  const userId = work ? work.author.userId : target.id
  if (!userId) throw new Error('没有找到快手创作者，请改用主页链接（www.kuaishou.com/profile/…）')

  const secUid = kuaishouSecUid(userId)
  const existing = getUserBySecUid(secUid)
  let user: DbUser
  let isNewUser = false
  if (existing) {
    user = existing
  } else {
    const profile = await fetchKuaishouProfile(userId)
    user = createUser({
      sec_uid: secUid,
      uid: userId,
      nickname: profile.name || work?.author.nickname || userId,
      signature: profile.signature,
      avatar: profile.avatar,
      unique_id: userId,
      short_id: userId,
      following_count: profile.following,
      follower_count: profile.follower,
      aweme_count: profile.photoCount,
      homepage_url: `https://www.kuaishou.com/profile/${userId}`,
      platform: 'kuaishou'
    })
    isNewUser = true
    emitUserAdded(user)
    if (profile.avatar) {
      const avatarPath = await downloadAvatar(secUid, profile.avatar)
      if (avatarPath) user = updateUser(user.id, { avatar_path: avatarPath }) ?? user
    }
    if (options) {
      user =
        updateUserSettings(user.id, {
          max_download_count: options.max_download_count,
          show_in_home: options.show_in_home,
          auto_sync: options.auto_sync,
          sync_cron: options.sync_cron
        }) ?? user
    }
  }

  return { user, isNewUser, postDownload: work ? startWorkDownload(user, work) : notVideo() }
}

function notVideo(): AddUserPostDownload {
  return { status: 'not-video-link' }
}

function startWorkDownload(user: DbUser, work: KuaishouWork): AddUserPostDownload {
  const awemeId = kuaishouAwemeId(work.workId)
  if (getSetting('download_post_on_add_user') === 'false') return { status: 'disabled' }
  if (getPostByAwemeId(awemeId)) return { status: 'already-downloaded', awemeId }
  void downloadKuaishouWork(user, work, 'single').then((ok) => {
    const payload = { awemeId, nickname: user.nickname }
    broadcast(
      ok ? { ...payload, status: 'success' } : { ...payload, status: 'failed', error: '下载失败' }
    )
  })
  return { status: 'downloading', awemeId }
}

function broadcast(payload: {
  awemeId: string
  nickname: string
  status: 'success' | 'failed'
  error?: string
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('user:addPostProgress', payload)
  }
}
