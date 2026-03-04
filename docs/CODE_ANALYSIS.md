# dYm 代码分析报告

> 抖音视频下载与智能分析管理工具 — 架构与代码质量分析

## 项目概览

**dYm** 是一个基于 Electron + React 19 + TypeScript 的桌面应用，用于抖音视频无水印下载与 AI 智能分析。

- 版本：1.3.1
- 许可证：GPL v3
- 核心依赖：Electron 39, React 19, better-sqlite3, fluent-ffmpeg, dy-downloader

## 架构总览

```
┌─────────────────────────────────────────────────┐
│                  Renderer (React)                │
│  React Router (Hash) + Redux Toolkit + Tailwind  │
│  shadcn/ui + Radix UI + Recharts + Sonner        │
├─────────────────────────────────────────────────┤
│                Preload (IPC Bridge)              │
│          18+ API 模块，241 行 IPC 桥接            │
├─────────────────────────────────────────────────┤
│               Main Process (Electron)            │
│  SQLite (better-sqlite3) + FFmpeg + dy-downloader│
│  node-cron + Grok AI API + electron-updater      │
└─────────────────────────────────────────────────┘
```

## 主进程服务层

| 服务 | 文件 | 职责 |
|------|------|------|
| Database | database/index.ts | SQLite (WAL模式)，5张表 |
| Douyin | services/douyin.ts | 封装 dy-downloader，解析 URL |
| Cookie | services/cookie.ts | 抖音 Cookie 获取与刷新 |
| Downloader | services/downloader.ts | 批量任务下载 |
| Syncer | services/syncer.ts | 增量同步用户新视频 |
| Analyzer | services/analyzer.ts | FFmpeg 帧提取 + Grok AI 分析 |
| Scheduler | services/scheduler.ts | node-cron 定时任务调度 |
| Updater | services/updater.ts | 自动更新 |

## 渲染进程页面

| 路由 | 页面 | 功能 |
|------|------|------|
| / | DashboardPage | 统计概览与图表 |
| /browse | HomePage | 视频库浏览与多维筛选 |
| /download | DownloadPage | 下载任务管理 |
| /files | FilesPage | 文件管理与存储统计 |
| /analysis | AnalysisPage | AI 分析控制面板 |
| /settings | SystemPage | 系统设置 |
| /logs | LogsPage | 实时日志 |

## 发现的问题

### 高优先级

1. **Syncer/Downloader 代码重复** — 视频获取、批次下载逻辑高度雷同，应抽取公共模块
2. **内存风险** — videosToDownload 一次性加载所有待下载视频，大号频道可能 OOM
3. **临时帧文件泄漏** — FFmpeg 帧在进程崩溃时不清理
4. **数据库初始化清空任务** — initDatabase() 每次启动清空 download_tasks

### 中优先级

5. **无下载重试机制** — 单次失败即中止
6. **Cookie 静默刷新无降级** — 过期后不提示手动登录
7. **数据库无索引** — 高频查询字段缺少索引
8. **Redux Store 未使用** — reducer 为空，状态全在组件内

### 低优先级

9. **定时任务无抖动** — 多任务同时触发可能高负载
10. **base64 图片未压缩** — 可能超出 API token 限制

## 架构亮点

1. 自定义 `local://` 协议支持 Range 请求流式播放
2. MediaViewer 基于标签交叉的视频推荐算法
3. 剪贴板智能检测多种抖音链接格式
4. 完整 TypeScript 类型定义（434 行）
5. `runWithConcurrency()` 公平并发调度
