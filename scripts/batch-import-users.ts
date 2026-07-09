/**
 * 批量导入用户脚本
 * 使用方法: npx tsx scripts/batch-import-users.ts
 */

import Database from 'better-sqlite3'
import { DouyinHandler, getSecUserId, getAwemeId, setConfig } from 'polydl'
import { join } from 'path'
import { app } from 'electron'

// 用户链接列表
const URLS = [
  'https://v.douyin.com/J0d_PQO-Qnw/',
  'https://v.douyin.com/5FsGnl61GZM/',
  'https://v.douyin.com/kHvcsukeodk/',
  'https://v.douyin.com/pUuxmfFiFD4/',
  'https://v.douyin.com/DBzS4LXnKD4/',
  'https://v.douyin.com/k3mRhRgLnDY/',
  'https://v.douyin.com/M30_FbwlWcM/',
  'https://v.douyin.com/8nuk0xO5S_0/',
  'https://v.douyin.com/T0uK3SkWP7o/',
  'https://v.douyin.com/OfK4fTfWeMc/',
  'https://v.douyin.com/Jcu41O9kf6M/',
  'https://v.douyin.com/Dq-dPlSU9Gc/',
  'https://v.douyin.com/sVuFsn7C944/',
  'https://v.douyin.com/U875MdyUK6k/',
  'https://v.douyin.com/nClA7ka0lBM/',
  'https://v.douyin.com/mP_UzhnNrsQ/',
  'https://v.douyin.com/gAmrqTE1zwM/',
  'https://v.douyin.com/Y0TFFLsmBSE/',
  'https://v.douyin.com/o3Af1BOe7M4/',
  'https://v.douyin.com/-FhaHKVP2Mw/',
  'https://v.douyin.com/KLUi9C1CXtA/',
  'https://v.douyin.com/VmIklpoEr84/',
  'https://v.douyin.com/KV2kafnl06I/',
  'https://www.douyin.com/user/MS4wLjABAAAAJVfuco97q2J64tuDX6qdiswDhn6kR8P2rDLQ3CzwQYA',
  'https://www.douyin.com/user/MS4wLjABAAAAFCPDXzFibS0_aKIOM8b9vxRuHQgpOqba19oCGk1QSK0',
  'https://www.douyin.com/user/MS4wLjABAAAAOIdhngBb3tXqAuvzSWQqiYbNNWByOtkc6vxTZykUqWg',
  'https://www.douyin.com/user/MS4wLjABAAAAxPpScMXMQARPYZPsC0OfhlAm1qNjT-FVu2tBKD9op0xNV016MYtUIect04Rlm4UH',
  'https://www.douyin.com/user/MS4wLjABAAAAWN8G_2zg1aPAQDTt0tj0xe48X7NWgmrWeta8dcsFt7U',
  'https://www.douyin.com/user/MS4wLjABAAAAB25CYouCTU6v7glcdFbsKJAmMBpIpOq0ctn4ozAG4oo',
  'https://www.douyin.com/user/MS4wLjABAAAAzgV1cjuOpK_GKLD83PhLA-NvT_vQVT4Y3jusdhgSTOoJhN54I3p-P2SDjZtVtkD5',
  'https://www.douyin.com/user/MS4wLjABAAAAgReTf8WH1krTehKLu8MqRCetHgSeHpoabEaovVvmENCPRoyFF0du7dv8dw8PTCBr',
  'https://www.douyin.com/user/MS4wLjABAAAATe-HazvJb-v2Lmc16vjGnuRIGfwixtn69d695J5olQk',
  'https://www.douyin.com/user/MS4wLjABAAAA8rYyvrYE5AVIz8AG6_F6xzLKXaQQsvS3wM23Vdljep0',
  'https://www.douyin.com/user/MS4wLjABAAAAnrOvCapklhSxLwz2NKTxlMjv4h1IVPp3yKVLc-ZKuh0pX916xqptDh5HXESw_4GX',
  'https://www.douyin.com/user/MS4wLjABAAAAxXH6xPVUSbxOp4hKsDbwiSG8A3313hUtKYcLWZXrezE',
  'https://www.douyin.com/user/MS4wLjABAAAAP-6RatIh2cL6w5qW9amZUkKZcHV5Fi3GqkSGVPkIIO0',
  'https://www.douyin.com/user/MS4wLjABAAAAMEpNMjKa5wlts2pVfVfFI3joa2nFd-I53OZR86yztHw',
  'https://www.douyin.com/user/MS4wLjABAAAA7KRGT4Nel0HrZMSuT34QdrhazvGDk-kjyBNxtvG_vDJyapdpwlalr2lK4Zw_bPmU',
  'https://www.douyin.com/user/MS4wLjABAAAAQO858DMNWD1aHlNnW7ojt4ofN_wMceJf1x0hsxhNyIGHQ3r0PcP19Z67wVKRqD4D',
  'https://www.douyin.com/user/MS4wLjABAAAAGVktIq6OX2xtd9UqVf9ufnkMtr3kinWP8YJ7-lUITSNts9ugUEzV5vmKIPDhJ9OX',
  'https://www.douyin.com/user/MS4wLjABAAAA71cMtBKfF8qT-BqHTbLGs-JjSjYsNLYDDKFiTZY5sMSHRA6s5WhR48EjR8fW4F2R',
  'https://www.douyin.com/user/MS4wLjABAAAA9cNmYo0n--AEsg38KbEmpDXjpgDJ7oFqvBu2XauKGOM',
  'https://www.douyin.com/user/MS4wLjABAAAAFJp0hUihIwdclTC-EC8jcc0z0pD5lPytcKST5oo6KElxVjlI9g9YjHZbx31UYF8A',
  'https://www.douyin.com/user/MS4wLjABAAAAABynnwybPFxL_GqBUYhexRBUzB3_6lQK-Ldp6WYn0Ek',
  'https://www.douyin.com/user/MS4wLjABAAAAI21n9KdHl9uq7XIYQfV4HB7H9zzqRiEjOvBxBqhMDbQ',
  'https://www.douyin.com/user/MS4wLjABAAAA8l-ISgicMeW0U3ymd3oTNIgofneNPvKqxm-eswzIGdKOZiBMKZjSHHyGXHVMeUvC',
  'https://www.douyin.com/user/MS4wLjABAAAA__Q_nfnHBoZs27Sq4_AigGKCMi6gu66jARaM_eLZaQB2rX5JW73poR124PhJ6lvK',
  'https://www.douyin.com/user/MS4wLjABAAAAo90cN426Vh9RQpxyXJoshl8B4K0hMwVawVUJAbK1XiKXuIzn-jeqXyALIcRJa5_H',
  'https://www.douyin.com/user/MS4wLjABAAAALg00j-jHmZeCEeatby-pHmtuo6lMlMrtGxQAbvpjC9uBq4zvtRDV3Nd-Cg0ZGg21',
  'https://www.douyin.com/user/MS4wLjABAAAAECadf3oO3JLkmfycZrAA9fJHgj8jVHVNRkQjeGRUEZ5FmeWqZs1ekqhmyJbVu0Lx',
  'https://www.douyin.com/user/MS4wLjABAAAATtM5qVZhyYjvtbVHEd4qFXHpCvIWuACCd38klJWsKEph0q3QwYu6L8f7BrwIzbxP',
  'https://www.douyin.com/user/MS4wLjABAAAAyZRA-JJvvyHTvBr1vLEXYpZvjti1lgRMKuo6rTAjNnAbLvI6cNiif9kU7ptWcG1V',
  'https://www.douyin.com/user/MS4wLjABAAAAttCEtzfPgR1vHBJ7eArUY6ULPKPqqkVg7DRy0qnHyeE',
  'https://www.douyin.com/user/MS4wLjABAAAAK2jW2BNuFA9rAPvT96GxFaTLAUb29mjfEwrlJ_9Ed7c'
]

// 数据库路径 (与应用使用相同路径)
const DB_PATH = join(process.env.HOME || '', 'Library/Application Support/dYmanager/data.db')

async function parseDouyinUrl(
  url: string
): Promise<{ type: 'user' | 'video' | 'unknown'; id: string }> {
  // 尝试提取用户 ID
  try {
    const secUserId = await getSecUserId(url)
    if (secUserId) {
      return { type: 'user', id: secUserId }
    }
  } catch {}

  // 尝试提取作品 ID
  try {
    const awemeId = await getAwemeId(url)
    if (awemeId) {
      return { type: 'video', id: awemeId }
    }
  } catch {}

  return { type: 'unknown', id: '' }
}

async function main() {
  console.log('='.repeat(60))
  console.log('批量导入用户')
  console.log('='.repeat(60))
  console.log(`\n数据库路径: ${DB_PATH}`)
  console.log(`待导入链接数: ${URLS.length}`)

  // 打开数据库
  const db = new Database(DB_PATH)

  // 获取 cookie
  const cookieRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('douyin_cookie') as
    | { value: string }
    | undefined
  if (!cookieRow?.value) {
    console.error('\n❌ 未找到 Cookie，请先在应用中设置')
    process.exit(1)
  }

  // 初始化 handler
  setConfig({ encryption: 'ab' })
  const handler = new DouyinHandler({ cookie: cookieRow.value })
  console.log('\n✅ DouyinHandler 初始化成功')

  // 准备 SQL
  const insertStmt = db.prepare(`
    INSERT INTO users (sec_uid, uid, nickname, signature, avatar, short_id, unique_id, following_count, follower_count, total_favorited, aweme_count, homepage_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const checkStmt = db.prepare('SELECT id FROM users WHERE sec_uid = ?')

  let success = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < URLS.length; i++) {
    const url = URLS[i]
    console.log(`\n[${i + 1}/${URLS.length}] 处理: ${url.substring(0, 50)}...`)

    try {
      // 解析链接类型
      const parseResult = await parseDouyinUrl(url)
      console.log(`  链接类型: ${parseResult.type}`)

      let userData: Record<string, unknown>
      let homepageUrl = url

      if (parseResult.type === 'user') {
        // 用户链接
        const profileRes = await handler.fetchUserProfile(parseResult.id)
        userData = (profileRes as any)._data?.user
      } else if (parseResult.type === 'video') {
        // 作品链接
        const postDetail = await handler.fetchOneVideo(url)
        const secUid = (postDetail as any).secUserId
        if (!secUid) {
          console.log('  ⚠️ 无法从作品获取用户ID，跳过')
          failed++
          continue
        }
        const profileRes = await handler.fetchUserProfile(secUid)
        userData = (profileRes as any)._data?.user
        homepageUrl = `https://www.douyin.com/user/${secUid}`
      } else {
        console.log('  ⚠️ 无法识别链接类型，跳过')
        failed++
        continue
      }

      if (!userData) {
        console.log('  ⚠️ 获取用户信息失败，跳过')
        failed++
        continue
      }

      const secUid = userData.sec_uid as string

      // 检查是否已存在
      const existing = checkStmt.get(secUid)
      if (existing) {
        console.log(`  ⏭️ 用户 ${userData.nickname} 已存在，跳过`)
        skipped++
        continue
      }

      // 插入数据库
      insertStmt.run(
        secUid,
        (userData.uid as string) || '',
        (userData.nickname as string) || '',
        (userData.signature as string) || '',
        (userData.avatar_larger as { url_list?: string[] })?.url_list?.[0] ||
          (userData.avatar_medium as { url_list?: string[] })?.url_list?.[0] ||
          '',
        (userData.short_id as string) || '',
        (userData.unique_id as string) || '',
        (userData.following_count as number) || 0,
        (userData.follower_count as number) || 0,
        (userData.total_favorited as number) || 0,
        (userData.aweme_count as number) || 0,
        homepageUrl
      )

      console.log(`  ✅ 添加成功: ${userData.nickname}`)
      success++

      // 添加延迟避免请求过快
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (error) {
      console.log(`  ❌ 失败: ${(error as Error).message}`)
      failed++
    }
  }

  db.close()

  console.log('\n' + '='.repeat(60))
  console.log('导入完成!')
  console.log(`  成功: ${success}`)
  console.log(`  跳过 (已存在): ${skipped}`)
  console.log(`  失败: ${failed}`)
  console.log('='.repeat(60))
}

main().catch(console.error)
