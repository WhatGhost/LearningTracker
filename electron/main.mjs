import { app, BrowserWindow, safeStorage, session, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DESKTOP_PORT = 8999;
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
  process.env.LEARNING_TRACKER_RUNTIME = "desktop";
  const databaseModule = await import("../lib/database.mjs");
  const { configureApiKeyStorage } = await import("../lib/api-key-store.mjs");
  const secretSettingKeys = {
    apiKey: "llm.apiKey",
    subscriptionKey: "llm.subscriptionKey",
  };
  configureApiKeyStorage({
    kind: "system-encrypted",
    persistent: true,
    async get(name) {
      if (name === "apiKey" && process.env.LEARNING_TRACKER_API_KEY) return process.env.LEARNING_TRACKER_API_KEY;
      if (name === "subscriptionKey" && process.env.LEARNING_TRACKER_SUBSCRIPTION_KEY) {
        return process.env.LEARNING_TRACKER_SUBSCRIPTION_KEY;
      }
      const settingKey = secretSettingKeys[name];
      if (!settingKey) throw new Error("未知的密钥类型");
      const encrypted = databaseModule.getRawSetting(settingKey);
      if (!encrypted) return "";
      try {
        const buffer = Buffer.from(encrypted, "base64");
        if (typeof safeStorage.decryptStringAsync === "function") {
          return (await safeStorage.decryptStringAsync(buffer)).result;
        }
        return safeStorage.decryptString(buffer);
      } catch {
        throw new Error("无法解密本机保存的 API Key，请在设置中重新填写");
      }
    },
    async set(name, value) {
      const settingKey = secretSettingKeys[name];
      if (!settingKey) throw new Error("未知的密钥类型");
      if (!value) {
        databaseModule.setRawSetting(settingKey, "");
        return;
      }
      const encryptionAvailable = typeof safeStorage.isAsyncEncryptionAvailable === "function"
        ? await safeStorage.isAsyncEncryptionAvailable()
        : safeStorage.isEncryptionAvailable();
      if (!encryptionAvailable) throw new Error("当前系统无法安全保存 API Key");
      const encrypted = typeof safeStorage.encryptStringAsync === "function"
        ? await safeStorage.encryptStringAsync(value)
        : safeStorage.encryptString(value);
      databaseModule.setRawSetting(settingKey, encrypted.toString("base64"));
    },
  });
  const { configureMetadataFetch } = await import("../lib/link-metadata.mjs");
  const metadataSessions = new Map();

  async function metadataSessionFor(route) {
    const key = route.rules || "direct";
    if (!metadataSessions.has(key)) {
      metadataSessions.set(key, (async () => {
        const hash = createHash("sha256").update(key).digest("hex").slice(0, 12);
        const proxySession = session.fromPartition(`learning-tracker-metadata-${hash}`);
        await proxySession.setProxy(route.rules
          ? { mode: "fixed_servers", proxyRules: route.rules }
          : { mode: "direct" });
        return proxySession;
      })());
    }
    return metadataSessions.get(key);
  }

  function metadataRoutes() {
    const settings = databaseModule.getNetworkSettings();
    if (!settings.useProxy) return [{ label: "直连", rules: null }];
    const routes = [];
    if (settings.httpProxy) routes.push({ label: `HTTP 代理 ${settings.httpProxy}`, rules: settings.httpProxy });
    if (settings.socksProxy) routes.push({ label: `SOCKS5 代理 ${settings.socksProxy}`, rules: settings.socksProxy });
    if (settings.fallbackToDirect) routes.push({ label: "直连回退", rules: null });
    return routes;
  }

  configureMetadataFetch(async (input, init = {}) => {
    const errors = [];
    for (const route of metadataRoutes()) {
      try {
        const proxySession = await metadataSessionFor(route);
        const response = await proxySession.fetch(input, {
          ...init,
          bypassCustomProtocolHandlers: true,
        });
        if ([502, 503, 504].includes(response.status)) {
          errors.push(`${route.label}返回 HTTP ${response.status}`);
          continue;
        }
        return response;
      } catch (error) {
        errors.push(`${route.label}：${error instanceof Error ? error.message : "连接失败"}`);
      }
    }
    throw new Error(`网页抓取请求失败；${errors.join("；")}`);
  });

  const serverModule = await import("../server.mjs");
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
