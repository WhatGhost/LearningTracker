import { app, BrowserWindow, session, shell } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DESKTOP_PORT = 8999;
const METADATA_PROXIES = [
  {
    label: "HTTP 代理 127.0.0.1:17890",
    partition: "persist:learning-tracker-metadata-http",
    rules: "http://127.0.0.1:17890",
  },
  {
    label: "SOCKS5 代理 127.0.0.1:10801",
    partition: "persist:learning-tracker-metadata-socks",
    rules: "socks5://127.0.0.1:10801",
  },
];
let mainWindow = null;
let localServer = null;
let closeDatabase = null;
let localOrigin = null;
let isQuitting = false;

function handleSquirrelEvent() {
  const event = process.argv[1];
  if (process.platform !== "win32" || !event?.startsWith("--squirrel-")) return false;
  const updateExe = path.resolve(path.dirname(process.execPath), "..", "Update.exe");
  const executableName = path.basename(process.execPath);
  const action =
    event === "--squirrel-install" || event === "--squirrel-updated"
      ? "--createShortcut"
      : event === "--squirrel-uninstall"
        ? "--removeShortcut"
        : null;

  if (action) {
    try {
      const child = spawn(updateExe, [action, executableName], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
    } catch {
      // The installer will still complete if shortcut creation is unavailable.
    }
  }
  setTimeout(() => app.quit(), 1_000);
  return true;
}

const squirrelEventHandled = handleSquirrelEvent();
const hasSingleInstanceLock = squirrelEventHandled || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function databasePath() {
  return app.isPackaged
    ? path.join(app.getPath("userData"), "data", "reading-tracker.db")
    : path.join(projectRoot, "data", "reading-tracker.db");
}

async function startLocalServer() {
  process.env.LEARNING_TRACKER_DB_PATH = databasePath();
  const { configureMetadataFetch } = await import("../lib/link-metadata.mjs");
  const proxySessions = await Promise.all(
    METADATA_PROXIES.map(async (proxy) => {
      const proxySession = session.fromPartition(proxy.partition);
      await proxySession.setProxy({ mode: "fixed_servers", proxyRules: proxy.rules });
      await proxySession.clearCache();
      return { ...proxy, session: proxySession };
    }),
  );

  configureMetadataFetch(async (input, init = {}) => {
    const errors = [];
    for (const proxy of proxySessions) {
      try {
        const response = await proxy.session.fetch(input, {
          ...init,
          bypassCustomProtocolHandlers: true,
        });
        if ([502, 503, 504].includes(response.status)) {
          errors.push(`${proxy.label} 返回 HTTP ${response.status}`);
          continue;
        }
        return response;
      } catch (error) {
        errors.push(`${proxy.label}：${error instanceof Error ? error.message : "连接失败"}`);
      }
    }
    throw new Error(`代理请求失败；${errors.join("；")}`);
  });

  const serverModule = await import("../server.mjs");
  const databaseModule = await import("../lib/database.mjs");
  localServer = serverModule.server;
  closeDatabase = databaseModule.closeDatabase;

  await new Promise((resolve, reject) => {
    const tryListen = (port) => {
      const onError = (error) => {
        localServer.off("listening", onListening);
        if (error.code === "EADDRINUSE" && port !== 0) tryListen(0);
        else reject(error);
      };
      const onListening = () => {
        localServer.off("error", onError);
        resolve();
      };
      localServer.once("error", onError);
      localServer.once("listening", onListening);
      localServer.listen(port, "127.0.0.1");
    };
    tryListen(DEFAULT_DESKTOP_PORT);
  });

  const address = localServer.address();
  localOrigin = `http://127.0.0.1:${address.port}`;
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f7f6f2",
    title: "阅迹",
    icon: path.join(projectRoot, "public", "favicon.svg"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(localOrigin)) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(localOrigin);
}

async function stopLocalServer() {
  if (localServer?.listening) {
    await new Promise((resolve) => localServer.close(resolve));
  }
  localServer = null;
  closeDatabase?.();
  closeDatabase = null;
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on("before-quit", (event) => {
  if (isQuitting || !localServer) return;
  event.preventDefault();
  isQuitting = true;
  void stopLocalServer().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!mainWindow && localOrigin) createMainWindow();
});

if (!squirrelEventHandled) {
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    await startLocalServer();
    createMainWindow();
  }).catch((error) => {
    console.error("Failed to start Learning Tracker:", error);
    app.quit();
  });
}
