import { extractCreatorLink } from '../../../shared/platforms'
import { extractKuaishouPageDetail, type KuaishouPageDetail } from './html'
import { pageFromFeed, type KuaishouFeedPage } from './feed'
import { parseKuaishouInput } from './parse'
import { fetchSignedProfileFeed, fetchTextInPage, resolveInPage } from './page'

export async function resolveKuaishouAddress(input: string): Promise<string> {
  const extracted = extractCreatorLink(input)?.url ?? input.trim()
  const parsed = parseKuaishouInput(extracted)
  if (parsed.kind !== 'short') return extracted
  return resolveInPage(parsed.url)
}

export async function loadKuaishouWork(input: string): Promise<{
  detail: KuaishouPageDetail
  pageUrl: string
}> {
  const pageUrl = await resolveKuaishouAddress(input)
  const parsed = parseKuaishouInput(pageUrl)
  if (parsed.kind !== 'work') throw new Error('无法识别的快手作品链接')
  const html = await fetchTextInPage(pageUrl)
  const detail = extractKuaishouPageDetail(html, parsed.photoId, parsed.web)
  if (!detail?.photoId) throw new Error('作品页里没有可下载的数据')
  if (!detail.authorId && parsed.userId) detail.authorId = parsed.userId
  return { detail, pageUrl }
}

export async function fetchProfileFeed(userId: string, cursor = ''): Promise<KuaishouFeedPage> {
  const payload = await fetchSignedProfileFeed(userId, cursor)
  return pageFromFeed(payload)
}
