# 阅迹 · Learning Tracker

一个本地优先的文章阅读清单。支持批量粘贴链接、自动抓取网页标题、跟踪阅读状态，并可使用你自己配置的大模型为未读文章添加分类标签。

## 功能

- 每次批量导入最多 50 个链接
- 自动读取 `og:title` 或网页 `<title>`
- 导入前预览并修改标题
- 自动识别“每行一个链接”、“说明文字 + 链接”和聊天软件导出的 Markdown 链接
- 使用 SQLite 持久化文章和阅读状态
- 已保存文章可修改标题、链接、阅读状态和标签
- 标签可新增、修改、停用、重新启用，并支持颜色、分组、说明和别名
- 大模型从现有标签中为文章选择 1 至 5 个标签，不会自动创建新标签
- 导入后异步自动分类，也可按文章重试或批量分类已有未读文章
- 支持 OpenAI 兼容的 Chat Completions 接口和连接测试
- 网页抓取可选择直连或代理，HTTP、SOCKS5 地址和直连回退策略均可配置
- 设置页面使用模型 API、网页抓取、标签分类和外观主题四个选项卡
- 内置 11 套完整配色，包括暖纸书房、海岸晴空、森林苔原、日落陶土、Catppuccin、Solarized、东京夜色、Nord、Dracula 和 Gruvbox 等，主题选择保存在本地
- 按标题、链接、网站域名或标签搜索
- 按阅读状态和标签筛选
- 防止重复链接写入
- 导出 JSON 备份
- 响应式桌面端和移动端界面

## 运行要求

- Node.js 22.13.0 或更高版本

SQLite 由 Node.js 内置模块提供，不需要安装或启动独立数据库；其他依赖通过 `npm install` 安装。

## 大模型自动分类

点击页面右上角的“设置”，填写：

- API Base URL，例如 `https://api.openai.com/v1` 或本地兼容服务地址
- 模型名称
- API Key；不需要 Key 的本地模型可以留空
- 可选的订阅密钥请求头、订阅密钥、用户请求头及其值
- 请求超时时间
- 每篇最多标签数（1 至 5）
- 是否自动分类新导入的未读文章

“保存并测试连接”会发送一条很小的示例分类请求，同时验证地址、鉴权、模型名称和 JSON 返回格式。仅查询模型列表不能完整验证分类能力，因此测试会实际调用一次模型。
如果兼容接口不支持完整 JSON Schema（例如返回 `Grammar error` 或 `Unimplemented keys`），应用会自动降级到 JSON Object 模式，并在本地继续校验和去重标签。

### AMD OnPrem 自定义请求头示例

对于下面这种 OpenAI SDK 配置：

```python
client = openai.OpenAI(
    base_url="https://llm-api.amd.com/OnPrem",
    api_key="dummy",
    default_headers={
        "Ocp-Apim-Subscription-Key": "actual_key",
        "user": os.getlogin(),
    },
)
```

在设置页中对应填写：

```text
API Base URL:       https://llm-api.amd.com/OnPrem
Bearer API Key:     dummy
订阅密钥请求头:      Ocp-Apim-Subscription-Key
订阅密钥:            真实的 actual_key
用户请求头:          user
用户请求头值:        Windows 用户名（可点击“使用当前系统用户”）
模型名称:            服务端提供的实际模型 ID
```

应用会向 `https://llm-api.amd.com/OnPrem/chat/completions` 发送请求，并同时携带 `Authorization: Bearer dummy`、订阅密钥和用户请求头。

自动分类使用文章标题、域名、URL 和网页描述，不发送整篇正文。模型只能从设置页中处于启用状态的标签中选择；请求失败时不会影响文章导入，列表会显示超时、鉴权、模型不存在、限流或格式解析等具体原因。

默认标签位于 [`config/default-labels.json`](config/default-labels.json)，其中包括 LLM、Agent、GPU、vLLM、SGLang、通信、Kernel、PD 分离等标签。该文件只负责首次初始化；设置页中的实际增删修改保存在 SQLite，不会在应用升级时被默认文件覆盖。

## 桌面应用（推荐）

安装依赖后，运行：

```bash
npm start
```

这会打开 Electron 桌面窗口，并在后台自动启动本地服务。关闭桌面窗口后，后台服务也会自动停止。

桌面版使用 Chromium 网络栈抓取标题。默认使用直连；可以在“设置 → 网页抓取网络”中启用 HTTP 和 SOCKS5 代理、修改地址，并选择代理失败后是否回退直连。修改后立即生效，不需要重启应用。界面不会获得 Node.js 或文件系统权限；文章链接会交给系统默认浏览器打开。

### 生成 Windows 便携版

```bash
npm run package:desktop
```

生成结果：

```text
out/LearningTracker-win32-x64/LearningTracker.exe
out/make/zip/win32/x64/LearningTracker-win32-x64.zip
```

ZIP 可以直接上传到 GitHub Release，解压后运行 `LearningTracker.exe`。`out/` 已加入 `.gitignore`，构建产物不会进入源码提交。

### 生成 Windows 安装程序

```bash
npm run make:desktop
```

该命令会同时生成便携版和 Squirrel 安装程序：

```text
out/make/squirrel.windows/x64/LearningTracker-Setup.exe
```

未签名的安装程序可能触发 Windows SmartScreen；正式公开分发时建议配置代码签名证书。日常自用优先使用便携 ZIP。

## 浏览器版本

如需继续使用原来的本地网页模式，执行：

```bash
npm run web
```

浏览器模式同样默认直连，并支持在设置页配置 HTTP 代理。SOCKS5 代理由 Electron 网络栈提供，因此仅桌面版支持。

需要在首次启动时通过环境变量预设代理，也可以使用：

```powershell
$env:LEARNING_TRACKER_HTTP_PROXY="http://127.0.0.1:17890"
$env:LEARNING_TRACKER_SOCKS_PROXY="socks5://127.0.0.1:10801"
npm run web
```

只设置 HTTP 代理即可；设置任意一个代理环境变量会使首次启动默认进入代理模式。之后在设置页保存的值以本地数据库配置为准。

然后打开：

```text
http://127.0.0.1:8999
```

开发网页服务时如需自动重启，可以运行：

```bash
npm run dev
```

默认端口是 `8999`。如端口已被占用，可以设置 `PORT` 环境变量，例如 PowerShell：

```powershell
$env:PORT=3100
npm run web
```

## 数据保存位置

源码开发和浏览器版本会自动创建：

```text
data/reading-tracker.db
```

这是一个本地 SQLite 文件。刷新页面、关闭浏览器或重启电脑都不会丢失数据。

`data/`、SQLite 主文件以及 WAL 临时文件均已写入 `.gitignore`，执行 `git add .` 时不会上传到 GitHub。

打包后的桌面应用使用 Electron 的用户数据目录，Windows 上通常位于：

```text
%APPDATA%\learning-tracker\data\reading-tracker.db
```

因此升级、移动或重新解压桌面应用不会覆盖数据库。该文件位于 Git 仓库之外，也不会被上传到 GitHub。

现有数据库会在启动时自动增加标签和分类字段，原有文章、阅读状态和链接都保持不变，不需要重新导入。

### 备份数据

有两种备份方式：

1. 在页面右上角点击“导出备份”，下载 JSON 文件。
2. 停止应用后，复制对应运行模式下的 `reading-tracker.db` 文件。

恢复 SQLite 备份时，先停止应用，再将备份文件放回 `data/reading-tracker.db`。

## 批量导入格式

每行可以只有链接：

```text
https://example.com/article-one
https://example.com/article-two
```

也可以直接粘贴聊天记录导出的 Markdown 格式。应用只读取括号中的真实链接，昵称、时间、日期、说明文字和 Markdown 显示文字都不会作为标题：

```text
WhatGhost 09:40
[文章标题: [https://mp.weixin.qq.com/s/example](https://mp.weixin.qq.com/s/example)]
```

无论使用哪种粘贴格式，标题都统一从目标网页抓取，不会从聊天记录文字中提取。

也可以附带说明文字：

```text
一篇关于阅读方法的文章 https://example.com/article-one
稍后研究：https://example.com/article-two
```

应用会在本机抓取网页标题。微信文章会使用更长超时、浏览器请求头以及 `msg_title` 兜底解析。标题提取失败时，导入预览会针对每个链接明确显示“抓取超时”“抓取失败”或“未找到网页标题”及详细原因；可以在导入前手动填写，也可以保存后通过文章右侧的修改按钮调整标题、链接和状态。

## 隐私和安全

- 服务只监听 `127.0.0.1`，局域网和互联网中的其他设备默认无法访问。
- 文章数据只写入当前项目的本地 SQLite 文件。
- 标题抓取只允许 HTTP/HTTPS，并会拒绝本机和常见内网地址。
- Electron 窗口启用上下文隔离和沙箱，不向页面暴露 Node.js API。
- 桌面版 Bearer API Key 和订阅密钥均通过 Electron `safeStorage` 使用操作系统能力加密后写入本机数据库，不会出现在 JSON 导出或 Git 仓库中。
- 浏览器运行模式没有 Electron 系统密钥库：设置页填写的密钥只保存在当前服务进程。需要重启后继续使用时，可在启动前设置 `LEARNING_TRACKER_API_KEY` 和 `LEARNING_TRACKER_SUBSCRIPTION_KEY` 环境变量。
- 应用不会把阅读数据发送到任何云端数据库；启用自动分类时，只会把分类所需的文章字段发送到你配置的模型接口。

## 项目结构

```text
LearningTracker/
├── config/
│   └── default-labels.json # 默认标签目录
├── lib/
│   ├── api-key-store.mjs  # API Key 存储适配
│   ├── database.mjs       # SQLite 初始化、迁移和数据操作
│   ├── link-metadata.mjs  # 链接解析与标题/描述抓取
│   └── llm-labeler.mjs    # 模型请求、校验和后台分类队列
├── electron/
│   └── main.mjs           # 桌面窗口和服务生命周期
├── public/
│   ├── app.js             # 页面状态和交互
│   ├── index.html         # 页面结构
│   └── styles.css         # 响应式样式
├── server.mjs             # 本地 HTTP 服务与 API
├── scripts/
│   └── package-desktop.mjs # Windows 便携包和安装包构建
├── forge.config.mjs       # Electron Forge 配置
├── package.json
└── .gitignore
```

## 测试

```bash
npm test
```

测试会使用临时数据库和本地模拟模型接口，不会修改 `data/reading-tracker.db`，也不会调用或消耗真实的大模型 API。
