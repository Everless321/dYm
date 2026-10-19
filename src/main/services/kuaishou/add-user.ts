import { BrowserWindow } from 'electron'
import { validate as validateCronExpression } from 'node-cron'
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
import {
  fetchProfileFeed,
  kuaishouHeaders,
  loadKuaishouWork,
  resolveKuaishouAddress
} from './client'
import { downloadKuaishouWork } from './download'
import type { KuaishouWork } from './feed'
import type { KuaishouPageDetail } from './html'
import { parseKuaishouInput } from './parse'

export async function addKuaishouCreator(
  rawUrl: string,
  rawOptions?: unknown
): Promise<AddUserResult> {
  const options = sanitizeAddCreatorOptions(rawOptions)
  if (options?.sync_cron && !validateCronExpression(options.sync_cron)) {
    throw new Error('同步计划不是合法的 Cron 表达式')
  }

  const resolved = await loadResolved(rawUrl)
  const userId = resolved.userId
  if (!userId) throw new Error('没有找到快手创作者，请改用主页链接（www.kuaishou.com/profile/…）')

  const profile = await loadProfile(userId, resolved.detail)
  const secUid = kuaishouSecUid(userId)
  const existing = getUserBySecUid(secUid)
  let user: DbUser
  let isNewUser = false
  if (existing) {
    user = existing
  } else {
    user = createUser({
      sec_uid: secUid,
      uid: userId,
      nickname: profile.name,
      signature: '',
      avatar: profile.avatar,
      unique_id: userId,
      short_id: userId,
      following_count: profile.following,
      follower_count: profile.followers,
      aweme_count: profile.photoCount,
      homepage_url: `https://www.kuaishou.com/profile/${userId}`,
      platform: 'kuaishou',
      platform_settings: JSON.stringify(options?.kuaishou ?? {})
    })
    isNewUser = true
    emitUserAdded(user)
    if (profile.avatar) {
      const avatarPath = await downloadAvatar(
        secUid,
        profile.avatar,
        kuaishouHeaders(user.homepage_url)
      )
      if (avatarPath) user = updateUser(user.id, { avatar_path: avatarPath }) ?? user
    }
    if (options) {
      user =
        updateUserSettings(user.id, {
          max_download_count: options.max_download_count,
          show_in_home: options.show_in_home,
          auto_sync: options.auto_sync,
          sync_cron: options.sync_cron,
          ...(options.kuaishou ? { platform_settings: options.kuaishou } : {})
        }) ?? user
    }
  }

  let postDownload: AddUserPostDownload = { status: 'not-video-link' }
  if (resolved.detail) {
    const enabled = getSetting('download_post_on_add_user') !== 'false'
    const awemeId = kuaishouAwemeId(resolved.detail.photoId)
    if (!enabled) postDownload = { status: 'disabled' }
    else if (getPostByAwemeId(awemeId)) {
      postDownload = { status: 'already-downloaded', awemeId }
    } else {
      postDownload = { status: 'downloading', awemeId }
      const target = user
      const work = workFromDetail(resolved.detail, profile)
      void downloadKuaishouWork(target, work, 'single').then((ok) => {
        const payload = { awemeId, nickname: target.nickname }
        broadcast(
          ok
            ? { ...payload, status: 'success' }
            : { ...payload, status: 'failed', error: '下载失败' }
        )
      })
    }
  }

  return { user, isNewUser, postDownload }
}

async function loadResolved(
  rawUrl: string
): Promise<{ userId: string; detail: KuaishouPageDetail | null }> {
  const address = await resolveKuaishouAddress(rawUrl)
  const parsed = parseKuaishouInput(address)
  if (parsed.kind === 'user') return { userId: parsed.userId, detail: null }
  if (parsed.kind !== 'work') throw new Error('无法识别的快手链接，请使用创作者主页或作品链接')
  const loaded = await loadKuaishouWork(address)
  return { userId: loaded.detail.authorId || parsed.userId, detail: loaded.detail }
}

async function loadProfile(
  userId: string,
  detail: KuaishouPageDetail | null
): Promise<{
  name: string
  avatar: string
  followers: number
  following: number
  photoCount: number
}> {
  try {
    const page = await fetchProfileFeed(userId)
    const sample = page.works[0]
    return {
      name: sample?.authorName || detail?.authorName || userId,
      avatar: sample?.avatarUrl || '',
      followers: sample?.fanCount || 0,
      following: sample?.followCount || 0,
      photoCount: sample?.photoCount || 0
    }
  } catch (error) {
    if (!detail?.authorName) throw error
    return { name: detail.authorName, avatar: '', followers: 0, following: 0, photoCount: 0 }
  }
}

function workFromDetail(detail: KuaishouPageDetail, profile: { avatar: string }): KuaishouWork {
  return {
    photoId: detail.photoId,
    caption: detail.caption,
    coverUrl: detail.coverUrl,
    downloadUrls: detail.photoUrl ? [detail.photoUrl] : [],
    musicUrl: '',
    timestampMs: detail.timestampMs,
    photoType: 'video',
    authorId: detail.authorId,
    authorName: detail.authorName,
    avatarUrl: profile.avatar,
    likeCount: detail.likeCount,
    viewCount: detail.viewCount,
    fanCount: 0,
    followCount: 0,
    photoCount: 0
  }
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
