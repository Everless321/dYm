# dYm

**[English](README.md) | [中文](README_CN.md)**

> AI 驱动的抖音视频分析与下载管理工具（Electron + TypeScript）

[![Electron](https://img.shields.io/badge/Electron-39.x-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19.x-61DAFB?logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)

dYm 是一个将**无水印视频下载**与 **AI 内容分析**相结合的桌面应用。专为内容创作者、社交媒体运营和研究人员打造，高效采集、整理和理解短视频内容。

[仓库地址](https://github.com/Everless321/dYm) · [Telegram 群组](https://t.me/+a02Yk5OY4gk1N2I1)

> 💬 加入 [Telegram 群组](https://t.me/+a02Yk5OY4gk1N2I1)，获取更新、交流与支持。

---

## AI 视频分析

dYm 的核心智能 —— 自动理解视频内容，无需逐个观看。

### 工作原理

1. **关键帧提取** — FFmpeg 按可配置间隔从视频中提取关键帧（如 30 秒视频提取 4 帧均匀分布的画面）
2. **视觉 API 分析** — 将提取的帧发送到多模态视觉大模型（兼容 OpenAI API）进行内容理解
3. **结构化输出** — AI 返回结构化元数据，存储到本地数据库中与每个视频关联

### AI 提取的内容

| 字段 | 说明 | 示例 |
|------|------|------|
| **标签** | 内容关键词，用于搜索和筛选 | `["烹饪", "食谱", "意面"]` |
| **分类** | 内容类别 | `美食烹饪` |
| **摘要** | 视频内容简述 | `意面卡邦尼步骤教程，附烹饪技巧` |
| **场景** | 视觉场景描述 | `厨房、室内、特写镜头` |
| **内容分级** | 内容安全等级（1-5） | `1`（适合所有观众） |

### 分析配置

- **模型选择** — 支持任何 OpenAI 兼容的视觉 API（Grok、OpenAI GPT-4o、Claude 等）
- **自定义提示词** — 精确定义 AI 应该在内容中关注什么
- **帧切片数** — 配置每个视频提取多少帧（在分析精度和 API 成本间权衡）
- **并发控制** — 多任务并行分析，可配置工作线程数
- **速率限制** — 内置 RPM（每分钟请求数）限制器，确保不超 API 配额
- **批量处理** — 一键分析所有未处理视频，实时展示进度
- **按用户分析** — 可分析指定创作者的视频，也可全量分析

### 图文作品支持

对于图文轮播作品（抖音图文模式），dYm 直接将原始图片发送到视觉 API，无需帧提取。每篇最多 10 张图片在一次 API 调用中完成分析。

---

## 功能特性

- **用户管理** — 添加和管理抖音创作者，支持批量刷新
- **直播录制** — 自动录制抖音直播（通过内置 FFmpeg 录原画 FLV），直播结束自动停止
- **批量下载** — 并发无水印下载，可配置下载数量，任务可追踪
- **智能筛选** — 按创作者、AI 标签、分类、内容分级多维筛选
- **本地存储** — SQLite 本地数据库，数据完全可控
- **剪贴板检测** — 自动识别抖音链接，一键添加
- **托盘运行** — 最小化到系统托盘后台运行

---

## 快速开始

1. 从 [Releases](https://github.com/Everless321/dYm/releases) 下载安装包
2. 打开 dYm，在设置中配置抖音 Cookie
3. 粘贴抖音链接或添加用户
4. 下载视频，按需开启 AI 分析

---

## 技术栈

- **框架**：Electron + React 19 + TypeScript
- **UI**：Tailwind CSS + Radix UI + shadcn/ui
- **数据库**：better-sqlite3
- **视频处理**：fluent-ffmpeg（AI 分析帧提取）
- **下载核心**：[polydl](https://www.npmjs.com/package/polydl)（视频 / 图文 / 直播下载器）
- **AI 集成**：OpenAI 兼容的视觉 API（可配置端点）

---

## 安装与开发

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

## 打包构建

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux

# 仅编译不打包
npm run build:unpack
```

产物位于 `dist/` 目录。

---

## 配置说明

### Cookie 设置（首次必做）

1. 进入设置页面
2. 点击「获取 Cookie」
3. 在弹窗中登录抖音
4. 登录成功后自动保存

### AI 分析设置（可选）

1. 进入设置 → 分析设置
2. 配置 API Key 和 API URL（默认为 Grok API）
3. 可自定义分析提示词、模型、并发数和速率限制

---

## 项目结构

```text
dYm/
├── src/
│   ├── main/                # Electron 主进程
│   │   ├── database/        # SQLite 数据库操作
│   │   ├── services/        # 下载、分析、调度等服务
│   │   │   └── analyzer.ts  # AI 视频分析引擎
│   │   └── index.ts
│   ├── preload/             # 预加载脚本
│   └── renderer/            # React 渲染进程
├── build/                   # 构建资源
├── resources/               # 应用资源
└── electron-builder.yml     # 打包配置
```

---

## 常用命令

```bash
npm run dev           # 开发模式
npm run typecheck     # 类型检查
npm run lint          # 代码检查
npm run format        # 格式化
npm run test:e2e      # E2E 测试
```

---

## 常见问题

### 下载失败怎么办？

请检查：
1. Cookie 是否正确且未过期
2. 网络连接是否正常
3. 下载目录是否有写权限

### AI 分析失败怎么办？

请确认：
1. API Key 配置正确
2. API 配额充足
3. 视频文件完整可读

### macOS 提示"应用已损坏/无法打开"怎么办？

执行：

```bash
sudo xattr -cr /Applications/dYm.app/
```

---

## 许可证

本项目采用 [GPL v3](https://www.gnu.org/licenses/gpl-3.0.html) 协议。

## 免责声明

本工具仅供学习与研究，请遵守当地法律法规及平台服务条款。下载内容版权归原作者所有。