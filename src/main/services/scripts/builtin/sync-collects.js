/**
 * 把当前登录账号收藏夹里的作品全部添加进来并下载。
 *
 * 收藏 / 收藏夹接口没有用户参数，抖音是按 cookie 判断「我」是谁的，
 * 所以拿到的一定是设置里那份 cookie 对应账号自己的收藏。
 *
 * 每个作品走的是和「添加用户」同一条路：解析作品 → 入库作者 → 触发下载。
 * 下载是后台进行的，脚本跑完不代表文件已经下完。
 *
 * 本文件以源码字符串的形式编译进包，与外部脚本走同一套 vm 运行时，
 * 想改下面这些参数，点「以此为模板新建」复制一份再改。
 */

/** 除收藏夹外，是否也处理「收藏」里的作品（含没归入任何收藏夹的） */
const INCLUDE_COLLECTION = true

/** 只处理这些收藏夹（按名称精确匹配），留空表示全部 */
const ONLY_COLLECTS = []

/** 数据库里已经有的作品是否跳过 */
const SKIP_EXISTING = true

/** 本次最多处理多少个作品，0 = 不限 */
const MAX_ITEMS = 0

/** 作品之间的随机等待区间（毫秒）——按风控松紧调整这两个值 */
const DELAY_MIN_MS = 3000
const DELAY_MAX_MS = 6000

/** addUser 返回的下载状态对应的说明 */
const STATUS_TEXT = {
  downloading: '已开始下载',
  'already-downloaded': '本地已有',
  disabled: '未开启添加时下载',
  unavailable: '拿不到作品数据'
}

exports.meta = {
  name: '同步收藏夹作品并下载',
  description: '读取当前登录账号的收藏夹，把里面的作品逐个添加进来并触发下载'
}

exports.run = async (api) => {
  const me = await api.douyin.me()
  if (!me.loggedIn) {
    throw new Error('当前 cookie 未登录，请先在设置里重新登录抖音')
  }
  api.log(`当前登录账号：抖音号 ${me.uniqueId || '未知'}（uid ${me.uid}）`)

  // 下载是「添加用户时下载作品」这个开关带起来的，关着就只入库不下载
  if (api.db.settings.get('download_post_on_add_user') === 'false') {
    api.log('⚠ 设置里「添加用户时下载作品」是关闭的，本次只会入库、不会下载。')
  }

  const collects = await api.douyin.collects()
  const targets = ONLY_COLLECTS.length
    ? collects.filter((collect) => ONLY_COLLECTS.includes(collect.name))
    : collects
  api.log(`共 ${collects.length} 个收藏夹，本次处理 ${targets.length} 个。`)

  // 同一个作品可能同时躺在多个收藏夹里，按 aweme_id 去重
  const seen = new Map()

  for (const collect of targets) {
    api.throwIfCancelled()
    const items = await api.douyin.collectsVideos(collect.id)
    let fresh = 0
    for (const item of items) {
      if (seen.has(item.awemeId)) continue
      seen.set(item.awemeId, { ...item, from: collect.name })
      fresh++
    }
    api.log(`  收藏夹「${collect.name}」：${items.length} 个作品，新增 ${fresh} 个待处理`)
  }

  if (INCLUDE_COLLECTION) {
    api.throwIfCancelled()
    const items = await api.douyin.collectionVideos()
    let fresh = 0
    for (const item of items) {
      if (seen.has(item.awemeId)) continue
      seen.set(item.awemeId, { ...item, from: '收藏' })
      fresh++
    }
    api.log(`  「收藏」：${items.length} 个作品，新增 ${fresh} 个待处理`)
  }

  let queue = [...seen.values()]
  api.log('———')
  api.log(`去重后共 ${queue.length} 个作品。`)

  if (SKIP_EXISTING) {
    const before = queue.length
    queue = queue.filter((item) => !api.db.posts.getByAwemeId(item.awemeId))
    api.log(`数据库里已有 ${before - queue.length} 个，跳过；剩余 ${queue.length} 个待添加。`)
  }

  if (MAX_ITEMS > 0 && queue.length > MAX_ITEMS) {
    api.log(`按 MAX_ITEMS 限制，本次只处理前 ${MAX_ITEMS} 个。`)
    queue = queue.slice(0, MAX_ITEMS)
  }

  if (queue.length === 0) {
    api.log('没有需要添加的作品，脚本结束。')
    return { account: me.uniqueId, collects: targets.length, total: 0, added: 0, failed: 0 }
  }

  const failed = []
  let added = 0
  let downloading = 0

  for (const [index, item] of queue.entries()) {
    api.throwIfCancelled()

    const position = `[${index + 1}/${queue.length}]`
    const title = (item.desc || item.awemeId).replace(/\s+/g, ' ').slice(0, 30)

    try {
      const result = await api.actions.addVideo(item.awemeId)
      added++
      const status = result && result.postDownload ? result.postDownload.status : ''
      if (status === 'downloading') downloading++
      api.log(
        `${position} ✔ [${item.from}] ${item.nickname} — ${title} · ${STATUS_TEXT[status] || status}`
      )
    } catch (error) {
      // 停止不算添加失败：直接向上抛出终止整个脚本，不记进失败列表
      if (api.cancelled) throw error
      const message = error.message || String(error)
      failed.push({ awemeId: item.awemeId, nickname: item.nickname, error: message })
      api.log(`${position} ✖ ${item.awemeId} 添加失败：${message}`)
    }

    // 最后一个作品之后无需再等
    if (index < queue.length - 1) {
      await api.sleep(DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)))
    }
  }

  api.log('———')
  api.log(`全部结束：成功 ${added} 个，失败 ${failed.length} 个，其中 ${downloading} 个进入下载。`)
  api.log('下载在后台进行，脚本结束不代表已经下完，进度看「下载」页。')
  if (failed.length > 0) {
    api.log('失败列表：')
    failed.forEach((item) => api.log(`  ${item.awemeId} [${item.nickname}] — ${item.error}`))
  }

  return {
    account: me.uniqueId,
    collects: targets.length,
    total: queue.length,
    added,
    downloading,
    failed: failed.length,
    failedItems: failed
  }
}
