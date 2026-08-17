/**
 * 把各架构 job 产出的 latest-mac.yml 合并成一份，并把全部产物汇总到一个目录。
 *
 * 背景：arm64 与 x64 的 mac 构建都会产出同名的 latest-mac.yml（不像 Linux 会分出
 * latest-linux-arm64.yml），直接平铺到一起会互相覆盖，导致一半 Mac 用户自动更新
 * 拿到错架构的包。见 electron-builder#5592。
 *
 * 合并是安全的：electron-updater 的 MacUpdater 按文件名里有没有 "arm64" 子串
 * 来分流——arm64 机器只取含 arm64 的条目，Intel 只取不含的，再在其中找 zip。
 * 所以一份 latest-mac.yml 里同时列出两个架构的文件即可。
 *
 * 用法：node merge-latest-mac.mjs <下载目录> <输出目录>
 * 下载目录形如 artifacts/dym-mac-arm64/、artifacts/dym-mac-x64/ …（每个 artifact 一个子目录）
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'

const [inputDir, outputDir] = process.argv.slice(2)
if (!inputDir || !outputDir) {
  console.error('用法: node merge-latest-mac.mjs <下载目录> <输出目录>')
  process.exit(1)
}

const MANIFEST = 'latest-mac.yml'

const subDirs = readdirSync(inputDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(inputDir, entry.name))

mkdirSync(outputDir, { recursive: true })

/** 各架构的 latest-mac.yml 路径 */
const manifestPaths = subDirs.map((dir) => join(dir, MANIFEST)).filter(existsSync)

// 先把除 latest-mac.yml 之外的所有产物平铺过去，同名文件视为异常
const seen = new Map()
for (const dir of subDirs) {
  for (const name of readdirSync(dir)) {
    if (name === MANIFEST) continue
    if (seen.has(name)) {
      console.error(`✖ 产物重名：${name}\n  来自 ${seen.get(name)} 与 ${dir}`)
      console.error('  同名文件会互相覆盖，请在 electron-builder 的 artifactName 里加上 ${arch}')
      process.exit(1)
    }
    seen.set(name, dir)
    copyFileSync(join(dir, name), join(outputDir, name))
  }
}
console.log(`已汇总 ${seen.size} 个产物到 ${outputDir}`)

if (manifestPaths.length === 0) {
  console.log('没有 latest-mac.yml，跳过合并')
  process.exit(0)
}

const docs = manifestPaths.map((path) => ({ path, doc: yaml.load(readFileSync(path, 'utf-8')) }))

if (docs.length === 1) {
  copyFileSync(docs[0].path, join(outputDir, MANIFEST))
  console.log(`只有一份 latest-mac.yml（${docs[0].path}），直接复制`)
  process.exit(0)
}

// 版本必须一致，否则说明产物来自不同的构建，合出来的清单会是错的
const versions = [...new Set(docs.map((d) => d.doc.version))]
if (versions.length > 1) {
  console.error(`✖ latest-mac.yml 版本不一致：${versions.join(' / ')}`)
  process.exit(1)
}

const files = []
const urls = new Set()
for (const { doc } of docs) {
  for (const file of doc.files ?? []) {
    if (urls.has(file.url)) continue
    urls.add(file.url)
    files.push(file)
  }
}

const hasArm64 = files.some((file) => file.url.includes('arm64'))
const hasIntel = files.some((file) => !file.url.includes('arm64'))
if (!hasArm64 || !hasIntel) {
  console.error(
    `✖ 合并结果只覆盖了一个架构（arm64=${hasArm64} intel=${hasIntel}）。\n` +
      '  electron-updater 靠文件名里的 arm64 子串分流，缺一边就会有用户更新到错架构的包。'
  )
  process.exit(1)
}

// path / sha512 是给旧版 electron-updater 的兜底字段。指向不含 arm64 的 zip：
// 万一旧客户端走到这里，Intel 包在 arm64 机器上能靠 Rosetta 跑，反过来则完全不行。
const fallback =
  files.find((file) => !file.url.includes('arm64') && file.url.endsWith('.zip')) ?? files[0]

const releaseDate = docs
  .map((d) => d.doc.releaseDate)
  .filter(Boolean)
  .sort()
  .pop()

const merged = {
  version: versions[0],
  files,
  path: fallback.url,
  sha512: fallback.sha512,
  ...(releaseDate ? { releaseDate } : {})
}

writeFileSync(join(outputDir, MANIFEST), yaml.dump(merged, { lineWidth: -1 }), 'utf-8')

console.log(`已合并 ${docs.length} 份 ${MANIFEST}：`)
files.forEach((file) => console.log(`  - ${file.url}`))
console.log(`  兜底 path → ${merged.path}`)
