import { initialize, trackEvent } from '@aptabase/electron/main'
import { getSetting } from '../database'

/**
 * 匿名使用统计（Aptabase）。
 *
 * - Aptabase App Key 是客户端公开值（会打包进安装包），不是密钥，可直接写死。
 * - 注册 https://aptabase.com → 新建 App → 复制 App Key 后替换下面的 APP_KEY。
 * - 只上报匿名数据：应用版本、操作系统、语言，以及少量功能事件名。
 *   绝不上报 Cookie、下载内容、抖音账号等任何个人或内容数据。
 * - SDK 不收集 IP、不设持久用户 ID，按天生成匿名 session。
 */
const APP_KEY: string = 'A-US-1664205856'
const APP_KEY_PLACEHOLDER = 'A-XX-XXXXXXXXXX'

const TELEMETRY_SETTING = 'telemetry_enabled'

let initialized = false

/** 是否启用遥测。默认开启（opt-out）：仅当用户显式关闭时为 false。 */
export function isTelemetryEnabled(): boolean {
  return getSetting(TELEMETRY_SETTING) !== 'false'
}

/** 必须在 app ready 之前调用（SDK 需要在 ready 前注册协议）。 */
export function initTelemetry(): void {
  if (APP_KEY === APP_KEY_PLACEHOLDER) return
  void initialize(APP_KEY)
  initialized = true
}

/** 上报一个事件。未配置 key 或用户已关闭时静默跳过。 */
export function track(event: string, props?: Record<string, string | number | boolean>): void {
  if (!initialized || !isTelemetryEnabled()) return
  void trackEvent(event, props)
}
