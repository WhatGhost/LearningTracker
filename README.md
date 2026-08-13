# 阅迹 · Learning Tracker

一个完全在本机运行的文章阅读清单。支持批量粘贴链接、自动抓取网页标题，并跟踪“未阅读、阅读中、已完成”三种阅读状态。

## 功能

- 每次批量导入最多 50 个链接
- 自动读取 `og:title` 或网页 `<title>`
- 导入前预览并修改标题
- 自动识别“每行一个链接”和“说明文字 + 链接”
- 使用 SQLite 持久化文章和阅读状态
- 已保存文章可修改标题、链接和阅读状态
- 按标题、链接或网站域名搜索
- 按阅读状态筛选
- 防止重复链接写入
- 导出 JSON 备份
- 响应式桌面端和移动端界面

## 运行要求

- Node.js 22.13.0 或更高版本

项目只使用 Node.js 内置模块，没有第三方运行依赖，不需要启动独立数据库。

## 桌面应用（推荐）

安装依赖后，运行：

```bash
npm start
```

这会打开 Electron 桌面窗口，并在后台自动启动本地服务。关闭桌面窗口后，后台服务也会自动停止。

桌面版使用 Chromium 网络栈抓取标题，并固定优先走 HTTP 代理 `127.0.0.1:17890`，失败后尝试 SOCKS5 代理 `127.0.0.1:10801`。界面不会获得 Node.js 或文件系统权限；文章链接会交给系统默认浏览器打开。

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

浏览器模式默认使用 HTTP 代理 `http://127.0.0.1:17890` 抓取外部网页。可以通过环境变量覆盖：

```powershell
$env:LEARNING_TRACKER_HTTP_PROXY="http://127.0.0.1:17890"
npm run web
```

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
- 应用不会把阅读数据发送到任何云端数据库。

## 项目结构

```text
LearningTracker/
├── lib/
│   ├── database.mjs       # SQLite 初始化和数据操作
│   └── link-metadata.mjs  # 链接解析与标题抓取
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

测试会使用临时数据库，不会修改 `data/reading-tracker.db`。
