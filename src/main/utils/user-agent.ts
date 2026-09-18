/**
 * 打开抖音页面（登录 / 静默刷新 / 页内签名请求）统一使用的 UA。
 *
 * 不再是常量：由本机的 DeviceProfile 派生，与 polydl 接口请求用的 UA、Client Hints、
 * browser_* 参数完全一致——Cookie 在哪个环境里拿到，就一直在哪个环境里用。
 * 同时抹掉了 Electron 标识：抖音页面会把 UA 解析成 browser_name / browser_version
 * 写进每个接口请求的参数里，不改的话就是在自报 browser_name=Electron。
 */
export { getDeviceUserAgent as getBrowserUserAgent } from '../services/douyin/device'
