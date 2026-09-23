import type { Session, WebContents } from 'electron'
import { clientHintsOf, userAgentOf, type DeviceProfile } from 'polydl'

/**
 * 让窗口里的 Client Hints 与 UA 自洽。
 *
 * webContents.setUserAgent 只改 UA 字符串：页面 JS 读到的 navigator.userAgentData 仍是
 * Electron 自己的内核（brands 只有 Chromium、没有 Google Chrome），请求也不带 sec-ch-ua。
 * 抖音的 secsdk 一比对就知道这不是真浏览器，在这种窗口里登录拿到的会话会被限制批量接口。
 *
 * CDP 的 Emulation.setUserAgentOverride 能覆盖 navigator.userAgentData，必须在页面加载前调用；
 * 但 Electron 不论怎么开 feature 开关都不发 sec-ch-ua 请求头（实测 39.3 如此），
 * 所以请求头这一半由 installClientHintHeaders 自己补上。
 */

interface Brand {
  brand: string
  version: string
}

/** 把 polydl 的 Sec-Ch-Ua（`"Google Chrome";v="142", ...`）解析成 CDP 要的结构 */
function parseBrands(secChUa: string): Brand[] {
  const brands: Brand[] = []
  for (const entry of secChUa.split(',')) {
    const match = entry.match(/"([^"]+)";\s*v="([^"]+)"/)
    if (match) brands.push({ brand: match[1], version: match[2] })
  }
  return brands
}

/** Windows 的 UA-CH 平台版本与 UA 里的 "Windows NT 10.0" 不同：11 报 15.0.0，10 报 10.0.0 */
function platformVersionOf(profile: DeviceProfile, systemVersion: string): string {
  if (profile.os !== 'windows') return profile.osVersion.replace(/_/g, '.')
  const build = Number(systemVersion.split('.')[2] ?? 0)
  return build >= 22000 ? '15.0.0' : '10.0.0'
}

export function applyClientHints(
  contents: WebContents,
  profile: DeviceProfile,
  systemVersion: string
): void {
  const hints = clientHintsOf(profile)
  const brands = parseBrands(hints['Sec-Ch-Ua'])
  const fullVersion = profile.browserVersion
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    // 不 detach：override 跟着这个调试会话，断开就失效
    void contents.debugger.sendCommand('Emulation.setUserAgentOverride', {
      userAgent: userAgentOf(profile),
      acceptLanguage: profile.language,
      userAgentMetadata: {
        brands,
        // 真实 Chrome 里只有 Chrome / Chromium 用完整版本号，占位品牌保留自己的版本
        fullVersionList: brands.map((b) => ({
          brand: b.brand,
          version: /chrom/i.test(b.brand) ? fullVersion : `${b.version}.0.0.0`
        })),
        fullVersion,
        platform: profile.os === 'windows' ? 'Windows' : 'macOS',
        platformVersion: platformVersionOf(profile, systemVersion),
        architecture: profile.os === 'windows' ? 'x86' : process.arch === 'arm64' ? 'arm' : 'x86',
        bitness: '64',
        model: '',
        mobile: false
      }
    })
  } catch (error) {
    // 覆盖不了就退回只改 UA：比直接失败强，登录仍可进行
    console.warn('[ClientHints] 设置失败，仅使用 UA:', (error as Error).message)
  }
}

/**
 * 给分区里发往抖音的请求补上 sec-ch-ua 系列请求头。
 *
 * 只补真实 Chrome 一定会发的三个低熵头，值与 polydl 直连用的同源（clientHintsOf）。
 * 完整版本号、平台版本这些高熵头不补：Chrome 只在服务端用 Accept-CH 要时才发，
 * 无条件发出去反而是新的破绽。
 */
export function installClientHintHeaders(ses: Session, profile: DeviceProfile): void {
  const hints = clientHintsOf(profile)
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*.douyin.com/*'] }, (details, callback) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        'sec-ch-ua': hints['Sec-Ch-Ua'],
        'sec-ch-ua-mobile': hints['Sec-Ch-Ua-Mobile'],
        'sec-ch-ua-platform': hints['Sec-Ch-Ua-Platform']
      }
    })
  })
}
