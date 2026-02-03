# dYm

抖音视频下载与智能分析管理工具

[![Electron](https://img.shields.io/badge/Electron-39.x-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.x-61DAFB?logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

### 我的证书噶了，所以Mac用户请自行执行命令签名 sudo xattr -cr /Applications/dYm.app/

## 功能特性

- **用户管理** - 添加、管理抖音用户，支持批量刷新用户信息
- **视频下载** - 批量下载用户视频，支持并发控制和下载数量限制
- **智能分析** - 使用 AI (Grok Vision API) 自动分析视频内容，生成标签、分类和摘要
- **内容筛选** - 按作者、标签、内容分级等多维度筛选视频
- **本地存储** - 使用 SQLite 数据库本地存储所有数据
- **剪贴板检测** - 自动检测复制的抖音链接，一键添加用户
- **系统托盘** - 最小化到托盘，后台静默运行

## 截图预览

<!-- 可以添加截图 -->

## 技术栈

- **框架**: Electron + React 19 + TypeScript
- **UI**: Tailwind CSS + Radix UI + shadcn/ui
- **数据库**: better-sqlite3
- **视频处理**: fluent-ffmpeg
- **下载核心**: [dy-downloader](https://github.com/Everless321/dyDownload)

## 系统要求

- Node.js 18+
- macOS / Windows / Linux
- FFmpeg (已内置)

## 安装

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/Everless321/dYmanager.git
cd dYmanager

# 安装依赖
npm install

# 开发模式运行
npm run dev
```

### 下载预编译版本

前往 [Releases](https://github.com/Everless321/dYmanager/releases) 页面下载适合您系统的安装包。

## 打包构建

### macOS

```bash
npm run build:mac
```

输出文件位于 `dist/` 目录：
- `dymanager-{version}.dmg` - DMG 安装包

### Windows

```bash
npm run build:win
```

输出文件位于 `dist/` 目录：
- `dymanager-{version}-setup.exe` - NSIS 安装程序

### Linux

```bash
npm run build:linux
```

输出文件位于 `dist/` 目录：
- `dymanager-{version}.AppImage` - AppImage 格式
- `dymanager-{version}.deb` - Debian 包
- `dymanager-{version}.snap` - Snap 包

### 仅编译不打包

```bash
npm run build:unpack
```

编译后的文件位于 `dist/` 目录，可直接运行。

## 配置说明

### Cookie 设置

首次使用需要配置抖音 Cookie：

1. 进入设置页面
2. 点击「获取 Cookie」按钮
3. 在弹出的窗口中登录抖音
4. 登录成功后 Cookie 会自动保存

### AI 分析设置（可选）

如需使用视频智能分析功能：

1. 进入设置 → 分析设置
2. 配置 Grok API Key 和 API URL
3. 可自定义分析提示词和参数

## 项目结构

```
dYm/
├── src/
│   ├── main/           # Electron 主进程
│   │   ├── database/   # SQLite 数据库操作
│   │   ├── services/   # 业务服务（下载、分析、调度等）
│   │   └── index.ts    # 主进程入口
│   ├── preload/        # 预加载脚本
│   └── renderer/       # React 渲染进程
│       ├── src/
│       │   ├── components/  # UI 组件
│       │   └── pages/       # 页面
│       └── index.html
├── build/              # 构建资源（图标等）
├── resources/          # 应用资源
└── electron-builder.yml  # 打包配置
```

## 开发命令

```bash
# 开发模式
npm run dev

# 类型检查
npm run typecheck

# 代码格式化
npm run format

# Lint 检查
npm run lint

# E2E 测试
npm run test:e2e
```

## 常见问题

### Q: 下载失败怎么办？

A: 请检查：
1. Cookie 是否已正确配置且未过期
2. 网络连接是否正常
3. 下载路径是否有写入权限

### Q: 视频分析失败？

A: 请确认：
1. Grok API Key 是否正确配置
2. API 配额是否充足
3. 视频文件是否完整

## 许可证

MIT License

## 免责声明

本工具仅供学习和研究使用，请遵守相关法律法规和平台服务条款。下载的内容版权归原作者所有。
