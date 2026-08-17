import type { PostDetailFilter, SharePageDetail, UserProfileFilter } from 'polydl'
import {
  fetchUserProfileBySecUid,
  fetchUserProfileSmart,
  fetchVideoDetail,
  getDouyinHandler,
  parseDouyinUrl
} from '../douyin'
import type {
  CollectedAweme,
  DouyinAccount,
  DouyinCollect,
  DouyinLink,
  DouyinUserInfo,
  DouyinVideoInfo,
  ScriptApi
} from './types'

/**
 * 脚本可用的抖音只读接口。
 *
 * 收藏 / 收藏夹这些接口没有 sec_uid 参数，抖音是按 cookie 判断「我」是谁的，
 * 所以那部分拿到的一律是当前登录账号自己的数据。
 */

/** 翻页之间的间隔，连续请求容易触发风控 */
const PAGE_INTERVAL_MS = 1500

/** 抖音接口返回里作品列表的形状，只取脚本用得上的字段 */
interface RawAweme {
  aweme_id?: string | number
  desc?: string
  create_time?: number
  author?: { nickname?: string; sec_uid?: string }
}

interface RawCollect {
  collects_id?: string | number
  collects_name?: string
  total_number?: number
}

function requireHandler(): NonNullable<ReturnType<typeof getDouyinHandler>> {
  const handler = getDouyinHandler()
  if (!handler) {
    throw new Error('未配置抖音 Cookie，请先在「设置 - 账号」里登录后再运行')
  }
  return handler
}

/** 收藏、收藏夹作品、作者作品列表返回的都是 aweme_list，抽取逻辑共用 */
function toCollectedAwemes(raw: Record<string, unknown>): CollectedAweme[] {
  const list = (raw.aweme_list ?? []) as RawAweme[]
  return list
    .filter((item) => item.aweme_id)
    .map((item) => ({
      awemeId: String(item.aweme_id),
      desc: item.desc ?? '',
      nickname: item.author?.nickname ?? '',
      secUid: item.author?.sec_uid ?? '',
      createTime: Number(item.create_time ?? 0)
    }))
}

/** 有 cookie 时是 PostDetailFilter，无 cookie 会回落到分享页，两种形状都要认 */
function isDetailFilter(detail: PostDetailFilter | SharePageDetail): detail is PostDetailFilter {
  return typeof (detail as PostDetailFilter).toAwemeData === 'function'
}

function toVideoInfo(detail: PostDetailFilter | SharePageDetail): DouyinVideoInfo {
  if (!isDetailFilter(detail)) {
    return {
      awemeId: detail.awemeId,
      desc: detail.desc ?? '',
      createTime: detail.createTime ?? 0,
      duration: detail.video?.duration ?? null,
      // 分享页不返回 aweme_type，只能按有没有图片粗判
      awemeType: detail.images?.length ? null : 0,
      cover: detail.video?.cover?.[0] ?? null,
      videoUrl: detail.video?.playAddr?.[0] ?? null,
      images: detail.images?.map((image) => image.urlList[0]) ?? null,
      author: {
        secUid: detail.author?.secUid ?? '',
        nickname: detail.author?.nickname ?? '',
        uid: detail.author?.uid ?? null,
        uniqueId: null
      },
      stats: {
        digg: detail.statistics?.diggCount ?? null,
        comment: detail.statistics?.commentCount ?? null,
        collect: detail.statistics?.collectCount ?? null,
        share: detail.statistics?.shareCount ?? null
      },
      hashtags: []
    }
  }

  // createTime 的 getter 返回的是格式化后的字符串，原始秒级时间戳要从 raw 里取
  const raw = detail.toRaw() as { aweme_detail?: { create_time?: number } }

  return {
    awemeId: detail.awemeId ?? '',
    desc: detail.desc ?? '',
    createTime: Number(raw.aweme_detail?.create_time ?? 0),
    duration: detail.duration,
    awemeType: detail.awemeType,
    cover: detail.cover,
    videoUrl: detail.videoPlayAddr?.[0] ?? null,
    images: detail.images,
    author: {
      secUid: detail.secUserId ?? '',
      nickname: detail.nickname ?? '',
      uid: detail.uid,
      uniqueId: detail.uniqueId
    },
    stats: {
      digg: detail.diggCount,
      comment: detail.commentCount,
      collect: detail.collectCount,
      share: detail.shareCount
    },
    hashtags: detail.hashtagNames ?? []
  }
}

function toUserInfo(profile: UserProfileFilter): DouyinUserInfo {
  return {
    secUid: profile.secUserId ?? '',
    uid: profile.uid,
    nickname: profile.nickname ?? '',
    signature: profile.signature ?? '',
    avatar: profile.avatarUrl,
    uniqueId: profile.uniqueId,
    shortId: profile.shortId,
    followerCount: profile.followerCount,
    followingCount: profile.followingCount,
    awemeCount: profile.awemeCount,
    totalFavorited: profile.totalFavorited
  }
}

/**
 * 构造 api.douyin。
 *
 * @param sleep 可被「停止」中断的等待，用于翻页间隔
 * @param throwIfCancelled 已请求停止时抛出，避免翻页翻到一半停不下来
 */
export function createDouyinApi(
  sleep: (ms: number) => Promise<void>,
  throwIfCancelled: () => void
): ScriptApi['douyin'] {
  /**
   * 把分页生成器读完。
   * 生成器在 yield 处挂起，所以这里的 sleep 就落在两次请求之间。
   * interval 传 0 关掉 polydl 自己的等待——它不响应「停止」。
   */
  async function drain<P extends { toRaw: () => Record<string, unknown> }, T>(
    pages: AsyncGenerator<P, void, unknown>,
    take: (raw: Record<string, unknown>) => T[],
    limit = 0
  ): Promise<T[]> {
    const out: T[] = []
    for await (const page of pages) {
      throwIfCancelled()
      out.push(...take(page.toRaw()))
      if (limit > 0 && out.length >= limit) return out.slice(0, limit)
      await sleep(PAGE_INTERVAL_MS)
    }
    return out
  }

  return {
    me: async (): Promise<DouyinAccount> => {
      const user = await requireHandler().fetchQueryUser()
      const uid = user.userUid || null
      return { uid, uniqueId: user.userUniqueId || null, loggedIn: !!uid }
    },

    video: async (urlOrAwemeId: string): Promise<DouyinVideoInfo> => {
      const detail = await fetchVideoDetail(urlOrAwemeId.trim())
      if (!detail) throw new Error(`拿不到作品信息：${urlOrAwemeId}`)
      return toVideoInfo(detail)
    },

    user: async (urlOrSecUid: string): Promise<DouyinUserInfo> => {
      const input = urlOrSecUid.trim()
      // 链接走完整解析（能处理短链），否则当作 sec_uid 直接请求
      const profile = /^https?:\/\//i.test(input)
        ? await fetchUserProfileSmart(input)
        : await fetchUserProfileBySecUid(input)
      if (!profile) throw new Error(`拿不到作者资料：${input}（可能是广告号或已注销）`)
      return toUserInfo(profile as UserProfileFilter)
    },

    userVideos: async (secUid: string, limit = 0): Promise<CollectedAweme[]> =>
      drain(
        requireHandler().fetchUserPostVideos(secUid.trim(), { interval: 0 }),
        toCollectedAwemes,
        limit
      ),

    parseUrl: async (url: string): Promise<DouyinLink> => {
      const { type, id } = await parseDouyinUrl(url.trim())
      return { type, id }
    },

    collects: async (): Promise<DouyinCollect[]> =>
      drain(requireHandler().fetchUserCollects({ interval: 0 }), (raw) =>
        ((raw.collects_list ?? []) as RawCollect[])
          .filter((item) => item.collects_id)
          .map((item) => ({
            id: String(item.collects_id),
            name: item.collects_name ?? '',
            total: item.total_number ?? 0
          }))
      ),

    collectsVideos: async (collectsId: string): Promise<CollectedAweme[]> =>
      drain(
        requireHandler().fetchUserCollectsVideos(collectsId, { interval: 0 }),
        toCollectedAwemes
      ),

    collectionVideos: async (): Promise<CollectedAweme[]> =>
      drain(requireHandler().fetchUserCollectionVideos({ interval: 0 }), toCollectedAwemes)
  }
}
