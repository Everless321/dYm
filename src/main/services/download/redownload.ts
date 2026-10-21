import { existsSync, renameSync, rmSync } from 'fs'
import { getPostByAwemeId, getUserById, type DbPost } from '../../database'
import { normalizeCreatorPlatform } from '../../../shared/platforms'
import { downloadBilibiliCreator } from '../bilibili/download'
import { broadcastAddPostProgress } from '../users/add'
import { redownloadSinglePost } from './downloader'

/**
 * 旧目录先改名备份：polydl 遇到已存在的文件会跳过，不挪开的话损坏的文件永远换不掉。
 * 下载成功删备份，失败把备份还原。改名失败（Windows 上文件被占用）就原地下载。
 */
function backupFolder(post: DbPost): () => void {
  const folder = post.video_path
  if (!folder || !existsSync(folder)) return () => {}
  const backup = `${folder}.redownload-bak`
  try {
    rmSync(backup, { recursive: true, force: true })
    renameSync(folder, backup)
  } catch (error) {
    console.warn(`[Redownload] 备份旧目录失败，原地重下: ${(error as Error).message}`)
    return () => {}
  }
  return () => {
    try {
      if (getPostByAwemeId(post.aweme_id)) {
        rmSync(backup, { recursive: true, force: true })
      } else {
        rmSync(folder, { recursive: true, force: true })
        renameSync(backup, folder)
      }
    } catch (error) {
      console.warn(`[Redownload] 收尾失败 ${backup}: ${(error as Error).message}`)
    }
  }
}

/**
 * 删掉记录后立刻把这些作品下回来。不能靠 sync.start：设了下载数量限制时，
 * 同步只看最新 N 个作品，旧作品永远轮不到。
 * 结果走「添加作品」同一个进度通道，界面弹提示；批量时只报失败，免得几百条成功提示刷屏。
 */
export function startRedownload(posts: DbPost[], options: { quiet: boolean }): void {
  const finish = (post: DbPost, restore: () => void, error?: string): void => {
    restore()
    const failure = getPostByAwemeId(post.aweme_id) ? undefined : (error ?? '下载失败')
    if (!failure && options.quiet) return
    broadcastAddPostProgress({
      awemeId: post.aweme_id,
      nickname: post.nickname,
      status: failure ? 'failed' : 'success',
      error: failure
    })
  }

  const bilibiliByUser = new Map<number, DbPost[]>()
  for (const post of posts) {
    const user = getUserById(post.user_id)
    if (!user) {
      finish(post, () => {}, '创作者已被删除')
      continue
    }
    if (normalizeCreatorPlatform(user.platform) === 'bilibili') {
      bilibiliByUser.set(user.id, [...(bilibiliByUser.get(user.id) ?? []), post])
      continue
    }
    const restore = backupFolder(post)
    void redownloadSinglePost(user, post.aweme_id)
      .then((result) =>
        finish(post, restore, result.status === 'failed' ? result.error : undefined)
      )
      .catch((error: Error) => finish(post, restore, error.message))
  }

  // 哔哩哔哩按创作者合成一次下载，沿用它自己的限速
  for (const [userId, list] of bilibiliByUser) {
    const user = getUserById(userId)!
    const restores = list.map(backupFolder)
    const done = (error?: string): void =>
      list.forEach((post, i) => finish(post, restores[i], error))
    void downloadBilibiliCreator(user, {
      limit: list.length,
      concurrency: 1,
      isAborted: () => false,
      onlyBvids: list.map((post) => post.aweme_id),
      source: 'single'
    })
      .then(() => done())
      .catch((error: Error) => done(error.message))
  }
}
