import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeDatabase,
  createLabel,
  deleteArticle,
  exportData,
  getLlmSettings,
  importArticles,
  listArticles,
  listLabels,
  updateArticle,
  updateLabel,
  updateLlmSettings,
} from "./lib/database.mjs";
import {
  getApiKeyInfo,
  getSubscriptionKeyInfo,
  setApiKey,
  setSubscriptionKey,
} from "./lib/api-key-store.mjs";
import { configureMetadataFetch, fetchMetadataBatch, normalizeUrl, parseLinks } from "./lib/link-metadata.mjs";
import {
  queueArticleClassifications,
  queueImportedArticles,
  queueUnreadArticles,
  testLlmConnection,
} from "./lib/llm-labeler.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const port = Number.parseInt(process.env.PORT || "8999", 10);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const validStatuses = new Set(["all", "unread", "reading", "completed"]);

function systemUsername() {
  try {
    return userInfo().username || process.env.USERNAME || process.env.USER || "";
  } catch {
    return process.env.USERNAME || process.env.USER || "";
  }
}

function sendJson(response, statusCode, value, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("JSON 格式无效");
  }
}

function routeId(pathname) {
  const match = pathname.match(/^\/api\/articles\/(\d+)$/u);
  return match ? Number(match[1]) : null;
}

function routeArticleAction(pathname, action) {
  const match = pathname.match(new RegExp(`^/api/articles/(\\d+)/${action}$`, "u"));
  return match ? Number(match[1]) : null;
}

function routeLabelId(pathname) {
  const match = pathname.match(/^\/api\/labels\/(\d+)$/u);
  return match ? Number(match[1]) : null;
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/articles") {
    const status = validStatuses.has(url.searchParams.get("status")) ? url.searchParams.get("status") : "all";
    const parsedLabelId = Number(url.searchParams.get("label"));
    const labelId = Number.isInteger(parsedLabelId) && parsedLabelId > 0 ? parsedLabelId : null;
    sendJson(response, 200, listArticles({ search: url.searchParams.get("search") || "", status, labelId }));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/labels") {
    sendJson(response, 200, {
      labels: listLabels({ includeDisabled: url.searchParams.get("includeDisabled") === "true" }),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/labels") {
    const body = await readJsonBody(request);
    sendJson(response, 201, { label: createLabel(body) });
    return true;
  }

  const labelId = routeLabelId(url.pathname);
  if (labelId && request.method === "PATCH") {
    const body = await readJsonBody(request);
    const label = updateLabel(labelId, body);
    if (!label) sendJson(response, 404, { error: "标签不存在" });
    else sendJson(response, 200, { label });
    return true;
  }

  if (labelId && request.method === "DELETE") {
    const label = updateLabel(labelId, { enabled: false });
    if (!label) sendJson(response, 404, { error: "标签不存在" });
    else sendJson(response, 200, { label });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/settings/llm") {
    sendJson(response, 200, {
      settings: getLlmSettings(),
      apiKey: await getApiKeyInfo(),
      subscriptionKey: await getSubscriptionKeyInfo(),
      systemUsername: systemUsername(),
    });
    return true;
  }

  if (request.method === "PATCH" && url.pathname === "/api/settings/llm") {
    const body = await readJsonBody(request);
    const settings = updateLlmSettings(body);
    if (typeof body.apiKey === "string" && body.apiKey.trim()) await setApiKey(body.apiKey);
    if (body.clearApiKey === true) await setApiKey("");
    if (typeof body.subscriptionKey === "string" && body.subscriptionKey.trim()) {
      await setSubscriptionKey(body.subscriptionKey);
    }
    if (body.clearSubscriptionKey === true) await setSubscriptionKey("");
    sendJson(response, 200, {
      settings,
      apiKey: await getApiKeyInfo(),
      subscriptionKey: await getSubscriptionKeyInfo(),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/llm/test") {
    const result = await testLlmConnection();
    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/classification/unread") {
    const queued = queueUnreadArticles();
    sendJson(response, 202, { queued });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/links/preview") {
    const body = await readJsonBody(request);
    const links = parseLinks(body.text || "");
    if (!links.length) {
      sendJson(response, 400, { error: "没有识别到有效的 HTTP 或 HTTPS 链接" });
      return true;
    }
    const items = await fetchMetadataBatch(links);
    sendJson(response, 200, { items, truncated: links.length >= 50 });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/articles/import") {
    const body = await readJsonBody(request);
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) {
      sendJson(response, 400, { error: "请提交 1 至 50 篇文章" });
      return true;
    }

    const seen = new Set();
    const items = [];
    let repeatedInBatch = 0;
    for (const item of body.items) {
      try {
        const urlValue = normalizeUrl(String(item.url || ""));
        if (seen.has(urlValue)) {
          repeatedInBatch += 1;
          continue;
        }
        seen.add(urlValue);
        const title = String(item.title || "").trim().slice(0, 500);
        if (!title) throw new Error("文章标题不能为空");
        items.push({
          title,
          url: urlValue,
          domain: new URL(urlValue).hostname.replace(/^www\./u, ""),
          description: String(item.description || "").trim().slice(0, 2_000),
        });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : "文章数据无效" });
        return true;
      }
    }

    const result = importArticles(items);
    result.duplicates += repeatedInBatch;
    result.classificationQueued = queueImportedArticles(result.inserted.map((article) => article.id));
    sendJson(response, 201, result);
    return true;
  }

  const classifyArticleId = routeArticleAction(url.pathname, "classify");
  if (classifyArticleId && request.method === "POST") {
    const queued = queueArticleClassifications([classifyArticleId]);
    if (!queued) sendJson(response, 409, { error: "文章正在分类，或文章不存在" });
    else sendJson(response, 202, { queued });
    return true;
  }

  const articleId = routeId(url.pathname);
  if (articleId && request.method === "PATCH") {
    const body = await readJsonBody(request);
    const changes = {};
    if (Object.hasOwn(body, "title")) changes.title = body.title;
    if (Object.hasOwn(body, "status")) changes.status = body.status;
    if (Object.hasOwn(body, "labelIds")) changes.labelIds = body.labelIds;
    if (Object.hasOwn(body, "url")) {
      const articleUrl = normalizeUrl(String(body.url || ""));
      changes.url = articleUrl;
      changes.domain = new URL(articleUrl).hostname.replace(/^www\./u, "");
    }
    const article = updateArticle(articleId, changes);
    if (!article) sendJson(response, 404, { error: "文章不存在" });
    else sendJson(response, 200, { article });
    return true;
  }

  if (articleId && request.method === "DELETE") {
    if (!deleteArticle(articleId)) sendJson(response, 404, { error: "文章不存在" });
    else sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/export") {
    const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
    sendJson(
      response,
      200,
      exportData(),
      { "Content-Disposition": `attachment; filename="reading-tracker-${timestamp}.json"` },
    );
    return true;
  }

  return false;
}

async function serveStatic(urlPath, response) {
  const requestedPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.resolve(publicDir, `.${requestedPath}`);

  if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
    return false;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

export const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");

  try {
    if (url.pathname.startsWith("/api/") && (await handleApi(request, response, url))) {
      return;
    }

    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && (await serveStatic(url.pathname, response))) {
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务器错误";
    const statusCode = error?.code === "DUPLICATE_URL"
      ? 409
      : /不能为空|无效|过大|HTTP|最多|至少|请选择|应在|已存在/u.test(message)
        ? 400
        : 500;
    sendJson(response, statusCode, {
      error: message,
    });
  }
});

function shutdown() {
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const proxyUrl = process.env.LEARNING_TRACKER_HTTP_PROXY || "http://127.0.0.1:17890";
  const { ProxyAgent, fetch: undiciFetch } = await import("undici");
  const metadataDispatcher = new ProxyAgent(proxyUrl);
  configureMetadataFetch(async (input, init) => {
    try {
      return await undiciFetch(input, { ...init, dispatcher: metadataDispatcher });
    } catch (error) {
      const cause = error?.cause?.message || error?.message || "连接失败";
      throw new Error(`HTTP 代理 ${new URL(proxyUrl).host} 请求失败：${cause}`);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Learning Tracker running at http://127.0.0.1:${port} (metadata proxy: ${proxyUrl})`);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
