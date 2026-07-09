/**
 * 下载可分发的 ffmpeg / ffprobe 静态二进制到 resources/ffmpeg/。
 *
 * 为什么不用 @ffmpeg-installer(4.4) / ffmpeg-static(6.0)：
 *   抖音直播原画用「FLV codec id 12 = HEVC」的非标准中国 CDN 扩展，
 *   官方 ffmpeg 到 7.0 才支持解封装，旧版会录出 0 字节。这里取 8.x 静态构建。
 *
 * 源：
 *   macOS(arm64/amd64) + Linux(amd64/arm64) → martin-riedl.de（仅链接系统库，可分发）
 *   Windows(amd64)                          → BtbN FFmpeg-Builds（win64-gpl 静态包）
 *
 * 用法：
 *   node scripts/download-ffmpeg.mjs                        # 当前平台/架构
 *   node scripts/download-ffmpeg.mjs --platform windows --arch amd64
 *   node scripts/download-ffmpeg.mjs --force                # 强制重新下载
 */
import {
  existsSync,
  mkdirSync,
  chmodSync,
  rmSync,
  readdirSync,
  copyFileSync,
  writeFileSync
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(projectRoot, 'resources', 'ffmpeg')

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}
const force = process.argv.includes('--force')

const platform = arg('platform', { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform])
const arch = arg('arch', { arm64: 'arm64', x64: 'amd64' }[process.arch] || 'amd64')
const exe = platform === 'windows' ? '.exe' : ''

const ffmpegOut = join(outDir, `ffmpeg${exe}`)
const ffprobeOut = join(outDir, `ffprobe${exe}`)

if (!force && existsSync(ffmpegOut) && existsSync(ffprobeOut)) {
  console.log(`[ffmpeg] 已存在，跳过：${outDir}`)
  process.exit(0)
}

async function download(url, dest) {
  console.log(`[ffmpeg] 下载 ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}

function unzip(zip, dir) {
  mkdirSync(dir, { recursive: true })
  // 用系统自带工具解压，避免引入依赖。
  // Windows：bsdtar 会把 "C:\..." 当成远程主机导致 "Cannot connect to C"，改用 PowerShell Expand-Archive。
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`],
      { stdio: 'inherit' }
    )
  } else {
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir], { stdio: 'inherit' })
  }
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(p, name)
      if (found) return found
    } else if (entry.name === name) {
      return p
    }
  }
  return null
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  const tmp = join(tmpdir(), `ffdl-${process.pid}-${Date.now()}`)
  mkdirSync(tmp, { recursive: true })
  try {
    if (platform === 'windows') {
      // BtbN 单个 zip 同时含 ffmpeg.exe 与 ffprobe.exe（在 bin/ 下）
      const zip = join(tmp, 'ff.zip')
      await download(
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
        zip
      )
      const ex = join(tmp, 'ex')
      unzip(zip, ex)
      copyFileSync(findFile(ex, 'ffmpeg.exe'), ffmpegOut)
      copyFileSync(findFile(ex, 'ffprobe.exe'), ffprobeOut)
    } else {
      for (const [tool, out] of [
        ['ffmpeg', ffmpegOut],
        ['ffprobe', ffprobeOut]
      ]) {
        const zip = join(tmp, `${tool}.zip`)
        await download(
          `https://ffmpeg.martin-riedl.de/redirect/latest/${platform}/${arch}/release/${tool}.zip`,
          zip
        )
        const ex = join(tmp, tool)
        unzip(zip, ex)
        copyFileSync(findFile(ex, tool), out)
      }
      chmodSync(ffmpegOut, 0o755)
      chmodSync(ffprobeOut, 0o755)
    }
    console.log(`[ffmpeg] 完成：${platform}/${arch} → ${outDir}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(`[ffmpeg] 出错：${e.message}`)
  process.exit(1)
})
