# dYm Web Edition

Electron 版本的 Web 化重构，将桌面应用拆分为独立的后端服务 + 前端 SPA。

## 架构

```
packages/
├── shared/    # 共享 TypeScript 类型定义
├── server/    # Fastify 后端 (REST API + WebSocket)
└── web/       # Vite + React 前端 (SPA)
```

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Fastify 5 + better-sqlite3 + @fastify/websocket + node-cron |
| 前端 | Vite 7 + React 19 + TanStack Router + shadcn/ui + Tailwind CSS |
| 共享 | TypeScript 5，pnpm monorepo |
| 下载核心 | [dy-downloader](https://github.com/Everless321/dyDownload) |
| 视频处理 | fluent-ffmpeg (ffmpeg/ffprobe 内置) |
| AI 分析 | Grok Vision API |

## 快速启动

```bash
# 安装依赖
pnpm install

# 重建原生模块 (better-sqlite3)
cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && npx node-gyp rebuild && cd -

# 修复 ffmpeg/ffprobe 权限
chmod +x node_modules/.pnpm/@ffprobe-installer+darwin-arm64@*/node_modules/@ffprobe-installer/darwin-arm64/ffprobe
chmod +x node_modules/.pnpm/@ffmpeg-installer+darwin-arm64@*/node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg

# 启动后端 (必须设置 DYM_DATA_DIR)
DYM_DATA_DIR=/path/to/data pnpm --filter @dym/server dev

# 启动前端 (另一个终端)
pnpm --filter @dym/web dev
```

**环境变量:**

| 变量 | 必填 | 说明 |
|------|------|------|
| `DYM_DATA_DIR` | 是 | 数据存储目录 (SQLite DB + 下载文件) |
| `PORT` | 否 | 后端端口，默认 4000 |

## Electron → Web 变更对照

| Electron | Web |
|----------|-----|
| `window.api.*` IPC 调用 | `fetch()` REST API (`/api/*`) |
| `BrowserWindow.webContents.send()` | WebSocket 广播 (`/ws`) |
| `local://` 协议加载媒体 | `/media/` 静态文件服务 (Range 支持) |
| `app.getPath('userData')` | `DYM_DATA_DIR` 环境变量 (强制) |
| 浏览器窗口自动获取 Cookie | 手动输入 Cookie (设置页面) |
| Electron 自动更新 | 已移除 |
| 系统托盘 | 已移除 |
| 剪贴板检测 | 已移除 |

## 已知问题与修复记录

### 启动相关

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `better-sqlite3` NODE_MODULE_VERSION 不匹配 | pnpm 安装的是 Electron 版本的预编译二进制 | `node-gyp rebuild` 重新编译 |
| `ffprobe EACCES` 导致视频分析全部失败 | pnpm 安装后二进制文件丢失执行权限 | `chmod +x` 修复权限 |
| `DYM_DATA_DIR` 未设置时静默使用 cwd | 生产环境可能写入错误位置 | 改为强制要求，未设置则退出 |

### API 接口

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `POST /download/:id/start` 返回 400 | 前端对无 body 的 POST 也发送 `Content-Type: application/json` | 仅在有 body 时设置 header |
| 分析页面始终显示"停止分析" | `/api/analysis/status` 返回 `{ running: false }` 对象 (truthy)，前端期望直接 `boolean` | 所有状态接口统一返回裸值 |
| 用户同步 Play 按钮全部灰色 | `/api/sync/active` 返回 `{ userId: null }` 对象 (truthy) | 同上 |
| 用户设置保存后定时任务未注册 | `PUT /api/users/:id/settings` 未调用 scheduler | 保存后自动调用 `scheduleUser`/`unscheduleUser` |

## 项目结构

```
packages/shared/src/
  types.ts              # 所有共享类型 (DB models, API types, WS events)

packages/server/src/
  index.ts              # Fastify 入口，插件注册，服务初始化
  database/index.ts     # SQLite schema, CRUD, migrations
  services/
    douyin.ts           # 抖音 API 封装 (dy-downloader)
    syncer.ts           # 用户视频列表同步
    downloader.ts       # 批量视频下载
    scheduler.ts        # node-cron 定时任务调度
    analyzer.ts         # Grok Vision AI 视频分析
  routes/
    users.ts            # 用户 CRUD + 同步
    tasks.ts            # 下载任务 CRUD
    posts.ts            # 作品列表 + 媒体文件
    download.ts         # 下载控制 (start/stop/status)
    sync.ts             # 同步控制 + cron 验证
    analysis.ts         # 分析控制 + 统计
    settings.ts         # 全局设置
    system.ts           # 系统资源 + Grok 验证
  ws/index.ts           # WebSocket 广播基础设施

packages/web/src/
  api/client.ts         # HTTP API 客户端
  hooks/useWebSocket.ts # WebSocket 单例连接 + useWsChannel hook
  routes/index.tsx      # createBrowserRouter, lazy-loaded routes
  components/
    AppLayout.tsx        # 侧边栏布局
    MediaViewer.tsx      # 媒体查看器
    VideoDownloadDialog.tsx
    ui/                  # shadcn/ui 组件
  pages/
    HomePage.tsx         # 作品瀑布流
    settings/
      UsersPage.tsx      # 用户管理
      DownloadPage.tsx   # 下载任务列表
      TaskDetailPage.tsx # 任务详情 + 进度
      AnalysisPage.tsx   # AI 分析
      SystemPage.tsx     # 系统设置
      LogsPage.tsx       # 调度日志
```
