import type { FastifyInstance } from 'fastify'
import {
  getAllUsers,
  createUser,
  deleteUser,
  getUserById,
  getUserBySecUid,
  updateUser,
  updateUserSettings,
  batchUpdateUserSettings
} from '../database/index.js'
import {
  parseDouyinUrl,
  fetchUserProfile,
  fetchUserProfileBySecUid,
  fetchVideoDetail
} from '../services/douyin.js'
import type { UpdateUserSettingsInput } from '@dym/shared'
import { scheduleUser, unscheduleUser } from '../services/scheduler.js'

function extractUserData(res: unknown): Record<string, unknown> {
  const raw = res as { _data?: { user?: Record<string, unknown> } }
  return raw?._data?.user ?? {}
}

export function registerUserRoutes(server: FastifyInstance): void {
  server.get('/api/users', async () => {
    try {
      const users = getAllUsers()
      return { success: true, data: users }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Body: { url: string } }>('/api/users', async (request) => {
    try {
      const { url } = request.body as { url: string }
      console.log('[User:add] Input url:', url)

      const parseResult = await parseDouyinUrl(url)
      console.log('[User:add] Link type:', parseResult.type, 'id:', parseResult.id)

      let userData: Record<string, unknown>
      let homepageUrl = url

      if (parseResult.type === 'user') {
        const profileRes = await fetchUserProfileBySecUid(parseResult.id)
        userData = extractUserData(profileRes)
      } else if (parseResult.type === 'video') {
        try {
          const postDetail = await fetchVideoDetail(url)
          const detail = postDetail as unknown as Record<string, unknown>

          console.log('[User:add] PostDetail fields:', {
            secUserId: detail.secUserId,
            nickname: detail.nickname,
            uid: detail.uid
          })

          const secUid = detail.secUserId as string
          if (!secUid) {
            throw new Error('作品信息中未找到作者数据')
          }

          const profileRes = await fetchUserProfileBySecUid(secUid)
          userData = extractUserData(profileRes)

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

      const existing = getUserBySecUid(userData.sec_uid as string)
      if (existing) {
        throw new Error('用户已存在')
      }

      const input = {
        sec_uid: userData.sec_uid as string,
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

      const dbUser = createUser(input)
      console.log('[User:add] User created:', dbUser.id)

      return { success: true, data: dbUser }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.delete<{ Params: { id: string } }>('/api/users/:id', async (request) => {
    try {
      deleteUser(parseInt(request.params.id))
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Params: { id: string } }>('/api/users/:id/refresh', async (request) => {
    try {
      const id = parseInt(request.params.id)
      const user = getUserById(id)
      if (!user) throw new Error('用户不存在')

      const profileRes = await fetchUserProfile(user.homepage_url)
      const profile = extractUserData(profileRes)
      if (!profile) throw new Error('获取用户信息失败')

      const updated = updateUser(id, {
        nickname: profile.nickname as string,
        signature: profile.signature as string,
        avatar: (profile.avatar_larger as { url_list?: string[] })?.url_list?.[0] || (profile.avatar_medium as { url_list?: string[] })?.url_list?.[0] || '',
        following_count: profile.following_count as number,
        follower_count: profile.follower_count as number,
        total_favorited: profile.total_favorited as number,
        aweme_count: profile.aweme_count as number
      })

      return { success: true, data: updated }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Body: { users: { id: number; homepage_url: string; nickname: string }[] } }>(
    '/api/users/batch-refresh',
    async (request) => {
      try {
        const { users } = request.body as { users: { id: number; homepage_url: string; nickname: string }[] }
        const results = { success: 0, failed: 0, details: [] as string[] }

        for (const u of users) {
          try {
            const profileRes = await fetchUserProfile(u.homepage_url)
            const profile = extractUserData(profileRes)
            if (profile) {
              updateUser(u.id, {
                nickname: profile.nickname as string,
                signature: profile.signature as string,
                avatar: (profile.avatar_larger as { url_list?: string[] })?.url_list?.[0] || (profile.avatar_medium as { url_list?: string[] })?.url_list?.[0] || '',
                following_count: profile.following_count as number,
                follower_count: profile.follower_count as number,
                total_favorited: profile.total_favorited as number,
                aweme_count: profile.aweme_count as number
              })
              results.success++
              results.details.push(`OK ${u.nickname}`)
            } else {
              results.failed++
              results.details.push(`WARN ${u.nickname}: 获取失败，已跳过`)
            }
          } catch (error) {
            results.failed++
            results.details.push(`ERR ${u.nickname}: ${(error as Error).message}`)
          }
          await new Promise((resolve) => setTimeout(resolve, 300))
        }

        return { success: true, data: results }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  server.put<{ Params: { id: string }; Body: UpdateUserSettingsInput }>(
    '/api/users/:id/settings',
    async (request) => {
      try {
        const id = parseInt(request.params.id)
        const input = request.body as UpdateUserSettingsInput
        const updated = updateUserSettings(id, input)
        if (updated.auto_sync && updated.sync_cron) {
          scheduleUser(updated)
        } else {
          unscheduleUser(id)
        }
        return { success: true, data: updated }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )

  server.put<{ Body: { ids: number[]; settings: Omit<UpdateUserSettingsInput, 'remark'> } }>(
    '/api/users/batch-settings',
    async (request) => {
      try {
        const { ids, settings } = request.body as { ids: number[]; settings: Omit<UpdateUserSettingsInput, 'remark'> }
        batchUpdateUserSettings(ids, settings)
        return { success: true, data: null }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }
  )
}
