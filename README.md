# dYm

> 抖音视频下载与智能分析管理工具（Electron + TypeScript）

[![Electron](https://img.shields.io/badge/Electron-39.x-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.x-61DAFB?logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)

dYm 是一个面向内容创作者/运营同学的桌面工具：
- 无水印下载抖音视频
- 批量管理作者与视频素材
- 使用 AI 自动分析视频内容（标签/分类/摘要）

🔗 仓库地址：<https://github.com/Everless321/dYm>

---

## ✨ 核心特性

- **用户管理**：添加、管理抖音用户，支持批量刷新
- **批量下载**：并发控制、下载数量限制、任务可追踪
- **智能分析**：集成 AI（Grok Vision API）做视频内容理解
- **内容筛选**：按作者、标签、内容分级多维筛选
- **本地存储**：SQLite 本地数据库，数据可控
- **剪贴板检测**：自动识别抖音链接，一键添加
- **托盘运行**：支持最小化到系统托盘后台运行

---

## 🚀 快速开始（30 秒）

1. 从 [Releases](https://github.com/Everless321/dYm/releases) 下载适合系统的安装包
2. 打开 dYm，进入设置配置抖音 Cookie
3. 粘贴抖音链接或添加用户
4. 一键下载并按需开启 AI 分析

---

## 🖼 截图预览

> 建议在这里放 3 张图（主界面 / 下载任务 / AI 分析结果）

<!--
![主界面](docs/screenshots/main.png)
![下载任务](docs/screenshots/downloads.png)
![AI 分析](docs/screenshots/analysis.png)
-->

---

## 🛠 技术栈

- **框架**：Electron + React 19 + TypeScript
- **UI**：Tailwind CSS + Radix UI + shadcn/ui
- **数据库**：better-sqlite3
- **视频处理**：fluent-ffmpeg
- **下载核心**：[dy-downloader](https://github.com/Everless321/dyDownload)

---

## 📦 安装与开发

### 从源码运行

```bash
git clone https://github.com/Everless321/dYm.git
cd dYm
npm install
npm run dev
```

### 下载预编译版本

前往 [Releases](https://github.com/Everless321/dYm/releases) 下载安装包。

---

## 🏗 打包构建

### macOS

```bash
npm run build:mac
```

### Windows

```bash
npm run build:win
```

### Linux

```bash
npm run build:linux
```

### 仅编译不打包

```bash
npm run build:unpack
```

> 产物位于 `dist/` 目录（具体文件名以当前构建配置为准）。

---

## ⚙️ 配置说明

### 1) Cookie 设置（首次必做）

1. 进入设置页面
2. 点击「获取 Cookie」
3. 在弹窗中登录抖音
4. 登录成功后自动保存

### 2) AI 分析设置（可选）

1. 进入设置 → 分析设置
2. 配置 Grok API Key 和 API URL
3. 可自定义分析提示词与参数

---

## 📁 项目结构

```text
dYm/
├── src/
│   ├── main/                # Electron 主进程
│   │   ├── database/        # SQLite 数据库操作
│   │   ├── services/        # 下载、分析、调度等服务
│   │   └── index.ts
│   ├── preload/             # 预加载脚本
│   └── renderer/            # React 渲染进程
├── build/                   # 构建资源
├── resources/               # 应用资源
└── electron-builder.yml     # 打包配置
```

---

## 🧪 常用命令

```bash
npm run dev           # 开发模式
npm run typecheck     # 类型检查
npm run lint          # 代码检查
npm run format        # 格式化
npm run test:e2e      # E2E 测试
```

---

## ❓常见问题

### Q1: 下载失败怎么办？

请检查：
1. Cookie 是否正确且未过期
2. 网络连接是否正常
3. 下载目录是否有写权限

### Q2: AI 分析失败怎么办？

请确认：
1. Grok API Key 配置正确
2. API 配额充足
3. 视频文件完整可读

### Q3: macOS 提示“应用已损坏/无法打开”怎么办？

若遇到签名校验问题，可执行：

```bash
sudo xattr -cr /Applications/dYm.app/
```

---

## 📄 许可证

本项目采用 [GPL v3](https://www.gnu.org/licenses/gpl-3.0.html) 协议。

## ⚠️ 免责声明

本工具仅供学习与研究，请遵守当地法律法规及平台服务条款。下载内容版权归原作者所有。