import { execSync } from 'child_process'
import { app } from 'electron'

/**
 * Windows 开发时把控制台切到 UTF-8，修复中文日志乱码。
 *
 * electron-vite 用 stdio: 'inherit' 启动 Electron，Electron 把 UTF-8 字节原样写进继承来的句柄，
 * 控制台却按系统代码页（中文系统是 936 / GBK）解码，于是「已注册定时任务」显示成「宸叉敞鍐屽畾」。
 * 代码页属于整个控制台，子进程里跑 chcp 也会改到它。
 *
 * 只在开发模式做：打包后双击启动没有控制台，这时跑 chcp 会闪出一个黑窗口。
 * 必须作为入口的第一个 import，赶在其他模块打印日志之前执行。
 */
if (process.platform === 'win32' && !app.isPackaged) {
  try {
    execSync('chcp 65001', { stdio: 'ignore' })
  } catch {
    // 没有附着控制台时 chcp 会失败，不影响运行
  }
}
