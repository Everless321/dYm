import { join } from 'path'
import type { ScriptApi, ScriptModule } from '../types'

/**
 * 体检脚本样板：找出数据库有记录、但本地文件夹已不存在的作品。
 * 只报告不删除——确认结果无误后再按需要改成清理。
 */
const script: ScriptModule = {
  meta: {
    name: '检查失效作品记录',
    description: '扫描数据库中本地文件夹已不存在的作品，只报告不删除'
  },

  async run(api: ScriptApi) {
    const posts = api.db.query<{
      id: number
      aweme_id: string
      sec_uid: string
      nickname: string | null
      folder_name: string | null
    }>('SELECT id, aweme_id, sec_uid, nickname, folder_name FROM posts ORDER BY id')

    api.log(`共 ${posts.length} 条作品记录，开始比对本地文件夹…`)

    const missing = posts.filter((post) => {
      if (!post.folder_name) return true
      return !api.fs.exists(join(api.fs.downloadRoot, post.sec_uid, post.folder_name))
    })

    if (missing.length === 0) {
      api.log('所有作品记录都能对应到本地文件夹，没有发现问题。')
      return { checked: posts.length, missing: 0 }
    }

    api.log(`发现 ${missing.length} 条失效记录：`)
    missing.slice(0, 50).forEach((post) => {
      api.log(`  #${post.id} [${post.nickname ?? '未知作者'}] ${post.folder_name ?? '(无文件夹)'}`)
    })
    if (missing.length > 50) {
      api.log(`  …另有 ${missing.length - 50} 条未列出`)
    }
    api.log('本脚本不会自动删除，如需清理请复制为自定义脚本后调用 api.db.posts.delete(id)。')

    return {
      checked: posts.length,
      missing: missing.length,
      ids: missing.map((post) => post.id)
    }
  }
}

export default script
