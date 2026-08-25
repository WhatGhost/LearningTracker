<div align="center">
  <img src="public/favicon.svg" width="76" alt="阅迹图标" />
  <h1>阅迹 · Learning Tracker</h1>
  <p>一个本地优先的稍后阅读与文章整理工具。</p>
  <p><strong>简体中文</strong> · <a href="README_EN.md">English</a></p>

  <p>
    <img alt="Node.js 22.13+" src="https://img.shields.io/badge/Node.js-%E2%89%A522.13-339933?logo=nodedotjs&logoColor=white" />
    <img alt="Electron 43" src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white" />
    <img alt="SQLite" src="https://img.shields.io/badge/Storage-SQLite-003B57?logo=sqlite&logoColor=white" />
    <img alt="Windows" src="https://img.shields.io/badge/Desktop-Windows-0078D4?logo=windows11&logoColor=white" />
    <img alt="Local first" src="https://img.shields.io/badge/Data-Local%20First-5B5BD6" />
    <img alt="MIT License" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  </p>
</div>

## 阅迹是什么

我们经常在聊天软件、浏览器和社交平台里遇到值得阅读的文章，但链接很快就会被新的消息淹没。阅迹把这些分散的链接收进一个本地阅读队列：导入链接后自动抓取标题，记录阅读进度，用标签整理主题，并在需要时重新找到它们。

它关注的是一条简单、可持续的工作流：

```text
收集链接 → 自动补全标题 → 安排阅读 → 标记进度 → 按标签回顾
```

应用不依赖云端账号或在线数据库。文章清单、阅读状态、标签和设置都保存在自己的电脑上。

## 主要功能

### 快速收集文章

- 一次批量导入最多 50 个 HTTP/HTTPS 链接
- 支持每行一个链接、说明文字加链接，以及聊天软件导出的嵌套 Markdown 链接
- 标题统一从目标网页抓取，不把聊天昵称、时间或说明文字误当成标题
- 导入前可以预览和修改；抓取失败时显示超时或提取错误
- 自动规范化链接并阻止重复文章写入

### 跟踪阅读进度

- 使用“未阅读、阅读中、已完成”管理阅读队列
- 按标题、链接、网站域名或标签搜索
- 按阅读状态和标签筛选
- 随时修改文章标题、链接、状态和标签

### 整理与回顾

- 自定义标签名称、分组、颜色、说明和别名
- 标签可以完全手动维护和分配，不需要配置大模型
- 可配置 OpenAI 兼容的 LLM API、模型、鉴权请求头和超时时间
- 可开启 LLM 自动分类，为新导入或已有的未读文章选择 1 至 5 个已有标签
- 自动分类失败不会影响文章导入，随时可以重试或改为手动分配标签
- 导出 JSON 备份，便于迁移和恢复

### 本地桌面体验

- SQLite 持久化，刷新页面、重启应用或升级版本不会丢失数据
- Electron 桌面版和本地浏览器版使用同一套功能
- 内置 11 套完整主题，包括 Catppuccin、Solarized、Nord、Dracula 和 Gruvbox 风格
- 网页抓取网络支持可选代理，适应不同网络环境

## 安装

### 从 Release 安装（推荐）

前往项目的 [Releases 页面](https://github.com/WhatGhost/LearningTracker/releases/latest) 下载 Windows 版本：

- `LearningTracker-win32-x64.zip`：便携版，解压后运行 `LearningTracker.exe`
- `LearningTracker-Setup.exe`：安装版，按安装向导完成安装

便携版不会把数据写进解压目录，数据库仍保存在 Windows 用户数据目录中，因此替换或移动应用文件不会删除文章。

> 未签名的安装程序可能触发 Windows SmartScreen。可以核对 Release 来源后选择继续，或者使用便携版。

### 从源码运行

环境要求：Node.js 22.13.0 或更高版本。

```bash
git clone https://github.com/WhatGhost/LearningTracker.git
cd LearningTracker
npm install
npm start
```

`npm start` 会启动 Electron 桌面窗口及其本地服务。关闭桌面窗口后，后台服务会一并停止。

如需使用浏览器版本：

```bash
npm run web
```

然后访问 <http://127.0.0.1:8999>。在终端按 `Ctrl+C` 可以停止服务。

### 从源码构建

生成 Windows 便携版：

```bash
npm run package:desktop
```

生成便携版和 Squirrel 安装程序：

```bash
npm run make:desktop
```

构建结果位于 `out/`，该目录不会进入 Git 提交。

## 基本使用

点击右上角“批量导入”，粘贴一个或多个链接：

```text
https://example.com/article-one
https://example.com/article-two
```

也可以直接粘贴聊天记录：

```text
Reader 09:40
[文章标题: [https://example.com/article](https://example.com/article)]
```

阅迹只从这些内容中提取链接，标题会从网页重新抓取。确认预览后，文章会以“未阅读”状态加入清单。

阅读过程中可以直接修改状态；需要补充标题、修正链接或手动分配标签时，使用文章右侧的编辑按钮。

## 可选功能

阅迹的链接收集、阅读进度、搜索和手动标签功能不依赖任何额外服务。下面两项只在有相应需求时配置。

### 大模型自动分类（可选）

不配置模型时，可以在“设置 → 标签分类”中创建和维护标签，再通过文章编辑窗口手动选择。手动标签是完整功能，不是自动分类的降级模式。

配置模型的用途只是减少重复整理工作：阅迹会把文章标题、域名、URL、网页描述和当前启用的标签目录发送给兼容接口，让模型从已有标签中选择 1 至 5 个。模型不会创建新标签，也不会收到文章全文。

在“设置 → 模型 API”中可以配置：

- OpenAI 兼容的 API Base URL
- 模型名称和请求超时时间
- 可选的 Bearer API Key
- 企业网关需要的订阅密钥请求头和用户请求头
- 是否在导入新文章后自动执行分类

“保存并测试连接”会发送一次小型分类请求。接口不支持完整 JSON Schema 时，应用会自动降级到 JSON Object 模式，并在本地继续校验返回标签。模型请求失败不会影响文章导入或手动标签。

默认标签目录位于 [`config/default-labels.json`](config/default-labels.json)，包括 LLM、Agent、GPU、vLLM、SGLang、通信、Kernel、PD 分离等。首次启动后，实际标签配置保存在本地数据库中。

### 网页抓取代理（可选）

默认使用直连，不需要代理即可正常使用。代理配置只用于抓取文章标题和网页描述，适合目标网站在当前网络环境下访问较慢、超时或需要本地代理的情况。

代理不会应用到大模型 API 请求；模型接口和网页抓取使用两套独立的网络配置。

在“设置 → 网页抓取”中可以配置：

- HTTP/HTTPS 代理，例如 `http://127.0.0.1:<port>`
- SOCKS5 备用代理，例如 `socks5://127.0.0.1:<port>`
- 代理失败后是否回退直连
- 用指定网址测试当前配置

桌面版支持 HTTP 和 SOCKS5；浏览器版支持直连和 HTTP 代理。所有代理地址仅保存在本机。

## 数据与隐私

| 运行方式 | 数据库位置 | 密钥保存方式 |
| --- | --- | --- |
| 源码 / 浏览器版 | `data/reading-tracker.db` | 当前服务进程或环境变量 |
| 打包桌面版 | `%APPDATA%\learning-tracker\data\reading-tracker.db` | Electron `safeStorage` 操作系统加密 |

- 服务只监听 `127.0.0.1`，不会默认暴露给局域网或互联网
- 标题抓取只接受 HTTP/HTTPS，并拒绝本机和常见内网目标
- Electron 页面启用上下文隔离和沙箱，不暴露 Node.js 或文件系统 API
- JSON 备份不包含 Bearer Key 或订阅密钥
- 阅读数据不会写入云端数据库；仅在启用自动分类时请求用户配置的模型接口
- `data/`、`.env`、密钥文件、导出备份、`node_modules/` 和 `out/` 均由 [`.gitignore`](.gitignore) 排除

## 开发

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动 Electron 开发版 |
| `npm run web` | 启动本地浏览器版 |
| `npm run dev` | 监听代码变化并启动本地服务 |
| `npm test` | 运行自动化测试 |
| `npm run package:desktop` | 构建 Windows 便携版 |
| `npm run make:desktop` | 构建便携版和安装程序 |

测试使用临时数据库和本地模拟模型接口，不会修改真实阅读数据，也不会调用真实大模型 API。

```text
LearningTracker/
├── config/       默认标签目录
├── electron/     Electron 桌面入口
├── lib/          数据库、链接抓取与自动分类
├── public/       页面、样式和交互
├── scripts/      桌面打包脚本
├── test/         自动化测试
├── server.mjs    本地服务与 API
└── package.json
```

## License

本项目采用 [MIT License](LICENSE)。你可以自由使用、修改和分发代码，但需要保留原始版权和许可证声明。
