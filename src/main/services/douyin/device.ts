import { randomUUID } from 'crypto'
import os from 'os'
import { screen } from 'electron'
import {
  DeviceProfileSchema,
  createDeviceProfile,
  deviceFromUserAgent,
  setConfig,
  userAgentOf,
  type CreateDeviceProfileOptions,
  type DeviceProfile
} from 'polydl'
import { getSetting, setSetting } from '../../database'

/**
 * 抖音设备指纹：一台机器 = 一份 DeviceProfile。
 *
 * 登录窗口、静默刷新、页内签名请求（Electron 侧）和 polydl 的接口请求 / 文件下载
 * 全部用同一份 profile 派生的 UA / Client Hints / browser_* 参数，
 * 这样 Cookie 在哪个环境里拿到，就一直在哪个环境里用。
 *
 * profile 持久化在 settings 里，重新登录时换一份新的，与新 Cookie 同生同灭。
 */

const SETTING_KEY = 'douyin_device_profile'

/**
 * 2.10.x 及之前登录窗口写死的 UA。老用户升级时手里的 Cookie 是在这个 UA 下拿到的，
 * 首次生成 profile 时沿用它保证一致，等下次重新登录再换成真机指纹。
 */
const LEGACY_LOGIN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

let current: DeviceProfile | null = null

function machineOptions(seed: string): CreateDeviceProfileOptions {
  // navigator.deviceMemory 只会是 2 的幂且上限 8
  const memoryGb = os.totalmem() / 2 ** 30
  const deviceMemory = memoryGb >= 8 ? 8 : memoryGb >= 4 ? 4 : 2
  let screenSize: { width: number; height: number } | undefined
  try {
    const { width, height } = screen.getPrimaryDisplay().size
    if (width >= 1024 && height >= 600) screenSize = { width, height }
  } catch {
    // app 未 ready 时 screen 不可用，交给 polydl 按平台随机
  }
  return {
    os: process.platform === 'darwin' ? 'mac' : 'windows',
    screen: screenSize,
    cpuCores: Math.max(2, Math.min(32, os.cpus().length || 8)),
    deviceMemory,
    language: 'zh-CN',
    timezone: safeTimezone(),
    seed
  }
}

function safeTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  } catch {
    return 'Asia/Shanghai'
  }
}

/** 按本机硬件生成一份新 profile（不落库） */
export function createMachineProfile(): DeviceProfile {
  return createDeviceProfile(machineOptions(randomUUID()))
}

function loadStored(): DeviceProfile | null {
  const raw = getSetting(SETTING_KEY)
  if (!raw) return null
  try {
    return DeviceProfileSchema.parse(JSON.parse(raw))
  } catch (error) {
    console.warn('[Device] 已存的设备指纹不合法，重新生成:', (error as Error).message)
    return null
  }
}

/** 落库并让 polydl 立刻切换到这份 profile */
export function commitDeviceProfile(profile: DeviceProfile): DeviceProfile {
  current = profile
  setSetting(SETTING_KEY, JSON.stringify(profile))
  setConfig({ device: profile })
  return profile
}

/**
 * 当前生效的 profile。首次调用时：
 * - 已有 Cookie（老用户升级）→ 从旧登录 UA 反推，保持与手里 Cookie 一致
 * - 没有 Cookie → 直接按本机生成
 */
export function getDeviceProfile(): DeviceProfile {
  if (current) return current
  const stored = loadStored()
  if (stored) {
    current = stored
    setConfig({ device: stored })
    return stored
  }
  const hasCookie = !!getSetting('douyin_cookie')
  const { os: machineOs, ...rest } = machineOptions(randomUUID())
  const profile = hasCookie
    ? deviceFromUserAgent(LEGACY_LOGIN_UA, {
        ...rest,
        // 旧 UA 是 Mac；Windows 机器的真实分辨率配不上，交给 polydl 按 Mac 随机
        screen: machineOs === 'mac' ? rest.screen : undefined
      })
    : createDeviceProfile({ os: machineOs, ...rest })
  console.log(
    `[Device] 生成设备指纹（${hasCookie ? '沿用旧登录 UA，下次登录换真机' : '按本机'}）：${profile.os} ${profile.browser} ${profile.browserVersion} ${profile.screenWidth}x${profile.screenHeight}`
  )
  return commitDeviceProfile(profile)
}

/** 当前 profile 的 UA，Electron 侧所有抖音窗口都用它 */
export function getDeviceUserAgent(): string {
  return userAgentOf(getDeviceProfile())
}
