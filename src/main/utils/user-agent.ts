/**
 * 打开抖音页面（登录 / 静默刷新 Cookie / 页内签名请求）统一使用的 UA。
 *
 * 抹掉 UA 里的 Electron 标识：抖音页面会把 UA 解析成 browser_name / browser_version
 * 写进每个接口请求的参数里，不改的话就是在自报 browser_name=Electron。
 */
export const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
