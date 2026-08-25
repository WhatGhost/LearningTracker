<div align="center">
  <img src="public/favicon.svg" width="76" alt="Learning Tracker icon" />
  <h1>Learning Tracker</h1>
  <p>A local-first read-later and article organization app.</p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>

  <p>
    <img alt="Node.js 22.13+" src="https://img.shields.io/badge/Node.js-%E2%89%A522.13-339933?logo=nodedotjs&logoColor=white" />
    <img alt="Electron 43" src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white" />
    <img alt="SQLite" src="https://img.shields.io/badge/Storage-SQLite-003B57?logo=sqlite&logoColor=white" />
    <img alt="Windows" src="https://img.shields.io/badge/Desktop-Windows-0078D4?logo=windows11&logoColor=white" />
    <img alt="Local first" src="https://img.shields.io/badge/Data-Local%20First-5B5BD6" />
    <img alt="MIT License" src="https://img.shields.io/badge/License-MIT-yellow.svg" />
  </p>
</div>

## What is Learning Tracker?

Worthwhile articles often get buried across chat apps, browsers, and social platforms. Learning Tracker brings those scattered links into a local reading queue: import links, fetch their titles automatically, track reading progress, organize topics with labels, and find them again when you are ready to read.

It is designed around a simple and sustainable workflow:

```text
Collect links → Fetch titles → Schedule reading → Track progress → Revisit by label
```

The app does not require a cloud account or hosted database. Your articles, reading status, labels, and settings remain on your own computer.

## Key features

### Collect articles quickly

- Import up to 50 HTTP/HTTPS links at once
- Accept one link per line, descriptive text with links, and nested Markdown copied from chat exports
- Fetch titles from the target pages instead of mistaking chat names, timestamps, or surrounding text for titles
- Preview and edit articles before importing, with clear timeout and extraction errors when fetching fails
- Normalize URLs and prevent duplicate articles

### Track reading progress

- Manage a reading queue with Unread, Reading, and Completed states
- Search by title, URL, website domain, or label
- Filter by reading status and label
- Edit an article's title, URL, status, and labels at any time

### Organize and revisit

- Customize label names, groups, colors, descriptions, and aliases
- Maintain and assign labels manually without configuring an LLM
- Configure an OpenAI-compatible LLM API, model, authentication headers, and timeout
- Enable automatic LLM classification for newly imported or existing unread articles, selecting 1–5 existing labels
- Retry failed classifications or assign labels manually without affecting article imports
- Export JSON backups for migration and recovery

### Local desktop experience

- Persist data in SQLite so refreshes, restarts, and upgrades do not erase your reading list
- Use the same feature set in the Electron desktop app or the local browser version
- Choose from 11 complete themes inspired by Catppuccin, Solarized, Nord, Dracula, Gruvbox, and more
- Optionally configure a proxy for webpage metadata fetching in restricted or unreliable network environments

## Installation

### Install from a Release (recommended)

Open the project's [Releases page](https://github.com/WhatGhost/LearningTracker/releases/latest) and download a Windows build:

- `LearningTracker-win32-x64.zip`: portable build; extract it and run `LearningTracker.exe`
- `LearningTracker-Setup.exe`: installer build; follow the installation wizard

The portable build does not store your database inside the extracted application folder. Data remains in the Windows user data directory, so moving or replacing the application files does not remove your articles.

> Windows SmartScreen may warn about an unsigned installer. Verify that the file came from this project's Release page before continuing, or use the portable build.

### Run from source

Requirement: Node.js 22.13.0 or later.

```bash
git clone https://github.com/WhatGhost/LearningTracker.git
cd LearningTracker
npm install
npm start
```

`npm start` launches the Electron window and its local service. Closing the desktop window also stops the background service.

To use the browser version instead:

```bash
npm run web
```

Then open <http://127.0.0.1:8999>. Press `Ctrl+C` in the terminal to stop the service.

### Build from source

Create the Windows portable build:

```bash
npm run package:desktop
```

Create both the portable build and the Squirrel installer:

```bash
npm run make:desktop
```

Build artifacts are written to `out/`, which is excluded from Git commits.

## Basic usage

Click **Batch Import** in the top-right corner and paste one or more links:

```text
https://example.com/article-one
https://example.com/article-two
```

You can also paste a chat export directly:

```text
Reader 09:40
[Article title: [https://example.com/article](https://example.com/article)]
```

Learning Tracker extracts only the links from this text and fetches fresh titles from the target pages. Once you confirm the preview, articles are added with the Unread status.

Update the status as you read. Use the edit button beside an article whenever you need to correct its title or URL, or assign labels manually.

## Optional features

Link collection, reading progress, search, and manual labels work without any additional service. Configure the following features only when you need them.

### Automatic LLM classification (optional)

Without an LLM, you can create and maintain labels under **Settings → Label Classification**, then assign them manually in the article editor. Manual labels are a complete feature, not a fallback mode.

LLM configuration only reduces repetitive organization work. Learning Tracker sends the article title, domain, URL, webpage description, and enabled label catalog to a compatible API. The model selects 1–5 existing labels; it cannot create new labels and does not receive the full article body.

Under **Settings → Model API**, you can configure:

- An OpenAI-compatible API Base URL
- Model name and request timeout
- An optional Bearer API Key
- Subscription-key and user headers required by enterprise gateways
- Whether to classify new imports automatically

**Save and Test Connection** sends a small classification request. If an endpoint does not support full JSON Schema, the app automatically falls back to JSON Object mode and validates the returned labels locally. Model failures never block article imports or manual labeling.

The initial label catalog is stored in [`config/default-labels.json`](config/default-labels.json) and includes LLM, Agent, GPU, vLLM, SGLang, Communication, Kernel, PD Disaggregation, and other labels. After the first launch, the active label configuration is stored in the local database.

### Webpage-fetching proxy (optional)

Learning Tracker connects directly by default, so a proxy is not required for normal use. Proxy settings only affect webpage title and description fetching. They are useful when target websites are slow, time out, or require a local proxy in your network environment.

The proxy is not applied to LLM API requests. Model requests and webpage metadata fetching use separate network configurations.

Under **Settings → Web Fetching**, you can configure:

- An HTTP/HTTPS proxy such as `http://127.0.0.1:<port>`
- A fallback SOCKS5 proxy such as `socks5://127.0.0.1:<port>`
- Whether to fall back to a direct connection after proxy failures
- A URL for testing the current fetching configuration

The desktop build supports HTTP and SOCKS5 proxies. The browser build supports direct connections and HTTP proxies. Proxy addresses are stored locally.

## Data and privacy

| Runtime | Database location | Secret storage |
| --- | --- | --- |
| Source / browser build | `data/reading-tracker.db` | Current server process or environment variables |
| Packaged desktop build | `%APPDATA%\learning-tracker\data\reading-tracker.db` | OS encryption through Electron `safeStorage` |

- The local service listens only on `127.0.0.1` and is not exposed to your LAN or the internet by default
- Metadata fetching accepts only HTTP/HTTPS URLs and rejects localhost and common private-network targets
- The Electron renderer uses context isolation and sandboxing without Node.js or filesystem access
- JSON backups never contain the Bearer API Key or subscription key
- Reading data is never written to a cloud database; only optional classification requests are sent to your configured model endpoint
- `data/`, `.env`, key files, exported backups, `node_modules/`, and `out/` are excluded by [`.gitignore`](.gitignore)

## Development

| Command | Purpose |
| --- | --- |
| `npm start` | Start the Electron development app |
| `npm run web` | Start the local browser version |
| `npm run dev` | Start the local service in watch mode |
| `npm test` | Run the automated test suite |
| `npm run package:desktop` | Build the Windows portable package |
| `npm run make:desktop` | Build the portable package and installer |

Tests use a temporary database and a local mock model endpoint. They do not modify real reading data or call a real LLM API.

```text
LearningTracker/
├── config/       Initial label catalog
├── electron/     Electron desktop entry point
├── lib/          Database, link fetching, and classification
├── public/       Page structure, styles, and interactions
├── scripts/      Desktop packaging scripts
├── test/         Automated tests
├── server.mjs    Local service and API
└── package.json
```

## License

This project is licensed under the [MIT License](LICENSE). You may use, modify, and distribute the code as long as the original copyright and license notices are retained.
