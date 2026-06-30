import { BrowserWindow } from 'electron'
import {
  getSetting,
  createUser,
  updateUser,
  getUserBySecUid,
  getPostByAwemeId,
  type DbUser
} from '../database'
import { fetchUserProfileBySecUid, fetchVideoDetail, parseDouyinUrl } from './douyin'
import { downloadSinglePost } from './downloader'
import { downloadAvatar } from './avatar'

export type AddUserPostDownload =
  | { status: 'downloading'; awemeId: string }
  | { status: 'already-downloaded'; awemeId: string }
  | { status: 'disabled' }
  | { status: 'unavailable' }
  | { status: 'not-video-link' }

export interface AddUserResult {
  user: DbUser
  isNewUser: boolean
  postDownload: AddUserPostDownload
}

interface AddPostProgressPayload {
  awemeId: string
  nickname: string
  status: 'success' | 'failed' | 'already-downloaded'
  error?: string
}

function broadcastAddPostProgress(payload: AddPostProgressPayload): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('user:addPostProgress', payload)
  }
}

/**
 * 添加用户核心逻辑：解析链接（用户主页或作品）→ 抓取作者资料 → 入库；
 * 若为作品链接且开启「添加用户时下载作品」，后台下载该作品。
 * 供 IPC `user:add` 与收藏同步定时任务共用。
 */
export async function addUserByUrl(url: string): Promise<AddUserResult> {
  console.log('[User:add] Input url:', url)

  const parseResult = await parseDouyinUrl(url)
  console.log('[User:add] Link type:', parseResult.type, 'id:', parseResult.id)

  let userData: Record<string, unknown>
  let homepageUrl = url
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let awemeDataForDownload: any = null

  if (parseResult.type === 'user') {
    const profileRes = await fetchUserProfileBySecUid(parseResult.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userData = (profileRes as any)._data?.user
  } else if (parseResult.type === 'video') {
    try {
      const postDetail = await fetchVideoDetail(url)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = postDetail as any

      console.log('[User:add] PostDetail fields:', {
        secUserId: detail.secUserId,
        nickname: detail.nickname,
        uid: detail.uid
      })

      const secUid = detail.secUserId
      if (!secUid) {
        throw new Error('作品信息中未找到作者数据')
      }

      if (typeof detail.toAwemeData === 'function') {
        try {
          awemeDataForDownload = detail.toAwemeData()
        } catch (e) {
          console.error('[User:add] toAwemeData failed:', e)
        }
      }

      const profileRes = await fetchUserProfileBySecUid(secUid)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userData = (profileRes as any)._data?.user

      homepageUrl = `https://www.douyin.com/user/${secUid}`
    } catch (error) {
      console.error('[User:add] Failed to fetch video detail:', error)
      throw new Error(
        '获取作品详情失败，请尝试使用用户主页链接（点击作品中的作者头像，复制用户主页链接）'
      )
    }
  } else {
    throw new Error('无法识别的链接类型，请输入用户主页或作品链接')
  }

  if (!userData) {
    throw new Error('获取用户信息失败')
  }

  console.log('[User:add] User data:', {
    sec_uid: userData.sec_uid,
    uid: userData.uid,
    nickname: userData.nickname
  })

  const secUidStr = userData.sec_uid as string
  const existing = getUserBySecUid(secUidStr)

  let dbUser: DbUser
  let isNewUser = false
  if (existing) {
    dbUser = existing
  } else {
    const input = {
      sec_uid: secUidStr,
      uid: (userData.uid as string) || '',
      nickname: (userData.nickname as string) || '',
      signature: (userData.signature as string) || '',
      avatar:
        (userData.avatar_larger as { url_list?: string[] })?.url_list?.[0] ||
        (userData.avatar_medium as { url_list?: string[] })?.url_list?.[0] ||
        '',
      short_id: (userData.short_id as string) || '',
      unique_id: (userData.unique_id as string) || '',
      following_count: (userData.following_count as number) || 0,
      follower_count: (userData.follower_count as number) || 0,
      total_favorited: (userData.total_favorited as number) || 0,
      aweme_count: (userData.aweme_count as number) || 0,
      homepage_url: homepageUrl
    }
    console.log('[User:add] Creating user with:', JSON.stringify(input, null, 2))
    dbUser = createUser(input)
    isNewUser = true
    console.log('[User:add] User created:', dbUser.id)

    // 下载头像到本地（失败不影响添加流程）
    if (input.avatar) {
      const avatarPath = await downloadAvatar(secUidStr, input.avatar)
      if (avatarPath) {
        dbUser = updateUser(dbUser.id, { avatar_path: avatarPath }) ?? dbUser
      }
    }
  }

  // 决定是否触发作品下载
  let postDownload: AddUserPostDownload = { status: 'not-video-link' }

  if (parseResult.type === 'video') {
    const enabled = getSetting('download_post_on_add_user') !== 'false'
    if (!enabled) {
      postDownload = { status: 'disabled' }
    } else if (!awemeDataForDownload || !awemeDataForDownload.awemeId) {
      postDownload = { status: 'unavailable' }
    } else if (getPostByAwemeId(awemeDataForDownload.awemeId)) {
      postDownload = {
        status: 'already-downloaded',
        awemeId: awemeDataForDownload.awemeId
      }
    } else {
      postDownload = {
        status: 'downloading',
        awemeId: awemeDataForDownload.awemeId
      }

      // 后台下载，不阻塞返回
      const awemeData = awemeDataForDownload
      const targetUser = dbUser
      void (async () => {
        const result = await downloadSinglePost(targetUser, awemeData)
        const basePayload = {
          awemeId: awemeData.awemeId as string,
          nickname: targetUser.nickname
        }
        if (result.status === 'success') {
          broadcastAddPostProgress({ ...basePayload, status: 'success' })
        } else if (result.status === 'already-downloaded') {
          broadcastAddPostProgress({ ...basePayload, status: 'already-downloaded' })
        } else {
          broadcastAddPostProgress({
            ...basePayload,
            status: 'failed',
            error: result.error
          })
        }
      })()
    }
  }

  return { user: dbUser, isNewUser, postDownload }
}
