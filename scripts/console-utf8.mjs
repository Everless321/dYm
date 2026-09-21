// Windows 下把当前控制台切到 UTF-8（代码页 65001），修复 dev 日志中文乱码。
//
// 必须在 Electron 启动之前、由挂在这个控制台上的进程执行：Electron 是 GUI 程序，
// 不会附着到父控制台，在应用里跑 chcp 改的是它自己新开的控制台，没有效果。
// 代码页属于整个控制台，这里改完，后面 electron-vite / Electron 的输出都按 UTF-8 显示。
import { execSync } from 'node:child_process'

if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' })
  } catch {
    // 没有控制台（如 IDE 内置任务）时 chcp 会失败，不影响启动
  }
}
