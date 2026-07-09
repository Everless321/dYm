/**
 * 批量导入用户 → 输出 SQL
 *
 * 用法：
 *   DOUYIN_COOKIE="..." node scripts/batch-import-users.mjs ids.txt
 *
 * 将 SQL 直接写入数据库：
 *   DOUYIN_COOKIE="..." node scripts/batch-import-users.mjs ids.txt | \
 *     sqlite3 ~/Library/Application\ Support/dYmanager/data.db
 */

import { DouyinHandler, setConfig } from 'polydl'
import { readFileSync } from 'fs'

const file = process.argv[2]
if (!file) {
  process.stderr.write('用法: node scripts/batch-import-users.mjs <ids.txt>\n')
  process.exit(1)
}

const SEC_UIDS = readFileSync(file, 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean)

const COOKIE = process.env.DOUYIN_COOKIE

function esc(v) {
  return String(v ?? '').replace(/'/g, "''")
}

async function main() {
  if (!COOKIE) {
    process.stderr.write('❌ 请设置环境变量 DOUYIN_COOKIE\n')
    process.exit(1)
  }
  if (!SEC_UIDS.length) {
    process.stderr.write('❌ SEC_UIDS 为空，请填入 sec_uid 列表\n')
    process.exit(1)
  }

  setConfig({ encryption: 'ab' })
  const handler = new DouyinHandler({ cookie: COOKIE })

  let ok = 0, fail = 0

  for (let i = 0; i < SEC_UIDS.length; i++) {
    const secUid = SEC_UIDS[i].trim()
    process.stderr.write(`[${i + 1}/${SEC_UIDS.length}] ${secUid} ... `)

    try {
      const res = await handler.fetchUserProfile(secUid)
      const u = res?._data?.user
      if (!u) throw new Error('empty response')

      const avatar = u.avatar_larger?.url_list?.[0] ?? u.avatar_medium?.url_list?.[0] ?? ''
      process.stdout.write(
        `INSERT OR IGNORE INTO users (sec_uid,uid,nickname,signature,avatar,short_id,unique_id,following_count,follower_count,total_favorited,aweme_count,homepage_url) VALUES ('${esc(u.sec_uid)}','${esc(u.uid)}','${esc(u.nickname)}','${esc(u.signature)}','${esc(avatar)}','${esc(u.short_id)}','${esc(u.unique_id)}',${u.following_count|0},${u.follower_count|0},${u.total_favorited|0},${u.aweme_count|0},'https://www.douyin.com/user/${esc(u.sec_uid)}');\n`
      )
      process.stderr.write(`✓ ${u.nickname}\n`)
      ok++
    } catch (e) {
      process.stderr.write(`✗ ${e.message}\n`)
      fail++
    }

    if (i < SEC_UIDS.length - 1) await new Promise(r => setTimeout(r, 500))
  }

  process.stderr.write(`\n完成：成功 ${ok}，失败 ${fail}\n`)
}

main()
