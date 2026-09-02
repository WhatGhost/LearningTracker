import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultDataDir = path.join(projectRoot, "data");
const databasePath = process.env.LEARNING_TRACKER_DB_PATH
  ? path.resolve(process.env.LEARNING_TRACKER_DB_PATH)
  : path.join(defaultDataDir, "reading-tracker.db");
const dataDir = path.dirname(databasePath);

const DEFAULT_LLM_SETTINGS = Object.freeze({
  baseUrl: "https://api.openai.com/v1",
  model: "",
  autoLabel: false,
  timeoutMs: 20_000,
  maxLabels: 5,
  subscriptionHeaderName: "",
  userHeaderName: "",
  userHeaderValue: "",
});

const DEFAULT_NETWORK_SETTINGS = Object.freeze({
  useProxy: Boolean(process.env.LEARNING_TRACKER_HTTP_PROXY || process.env.LEARNING_TRACKER_SOCKS_PROXY),
  httpProxy: process.env.LEARNING_TRACKER_HTTP_PROXY || "",
  socksProxy: process.env.LEARNING_TRACKER_SOCKS_PROXY || "",
  fallbackToDirect: true,
});

mkdirSync(dataDir, { recursive: true });

export const database = new DatabaseSync(databasePath);

database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA busy_timeout = 5000");
database.exec("PRAGMA foreign_keys = ON");
database.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    domain TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread'
      CHECK (status IN ('unread', 'reading', 'completed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS articles_status_idx ON articles(status);
  CREATE INDEX IF NOT EXISTS articles_created_at_idx ON articles(created_at DESC);

  CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    group_name TEXT NOT NULL DEFAULT '自定义',
    description TEXT NOT NULL DEFAULT '',
    aliases TEXT NOT NULL DEFAULT '[]',
    color TEXT NOT NULL DEFAULT '#5b5bd6',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS article_labels (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'llm')),
    confidence REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (article_id, label_id)
  );
  CREATE INDEX IF NOT EXISTS article_labels_label_idx ON article_labels(label_id);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

function ensureArticleColumn(name, definition) {
  const columns = database.prepare("PRAGMA table_info(articles)").all();
  if (!columns.some((column) => column.name === name)) {
    database.exec(`ALTER TABLE articles ADD COLUMN ${name} ${definition}`);
  }
}

ensureArticleColumn("description", "TEXT NOT NULL DEFAULT ''");
ensureArticleColumn("label_status", "TEXT NOT NULL DEFAULT 'unclassified'");
ensureArticleColumn("label_error", "TEXT");
ensureArticleColumn("labeled_at", "TEXT");

function seedDefaultLabels() {
  const labelsPath = path.join(projectRoot, "config", "default-labels.json");
  const defaults = JSON.parse(readFileSync(labelsPath, "utf8"));
  const insert = database.prepare(`
    INSERT OR IGNORE INTO labels (slug, name, group_name, description, aliases, color)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const label of defaults) {
      insert.run(
        String(label.slug),
        String(label.name),
        String(label.group || "自定义"),
        String(label.description || ""),
        JSON.stringify(Array.isArray(label.aliases) ? label.aliases : []),
        String(label.color || "#5b5bd6"),
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

seedDefaultLabels();

const articleColumns = `
  articles.id,
  articles.title,
  articles.url,
  articles.domain,
  articles.description,
  articles.status,
  articles.label_status AS labelStatus,
  articles.label_error AS labelError,
  articles.labeled_at AS labeledAt,
  articles.created_at AS createdAt,
  articles.updated_at AS updatedAt
`;

function parseAliases(value) {
  try {
    const aliases = JSON.parse(value || "[]");
    return Array.isArray(aliases) ? aliases : [];
  } catch {
    return [];
  }
}

function labelFromRow(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    group: row.group_name,
    description: row.description,
    aliases: parseAliases(row.aliases),
    color: row.color,
    enabled: Boolean(row.enabled),
    articleCount: Number(row.article_count || 0),
    source: row.source,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
  };
}

function attachLabels(articles) {
  if (!articles.length) return articles;
  const ids = articles.map((article) => article.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT al.article_id, al.source, al.confidence,
           l.id, l.slug, l.name, l.group_name, l.description, l.aliases, l.color, l.enabled
    FROM article_labels al
    JOIN labels l ON l.id = al.label_id
    WHERE al.article_id IN (${placeholders})
    ORDER BY l.group_name, l.name COLLATE NOCASE
  `).all(...ids);
  const labelsByArticle = new Map(ids.map((id) => [id, []]));
  for (const row of rows) labelsByArticle.get(row.article_id)?.push(labelFromRow(row));
  return articles.map((article) => ({ ...article, labels: labelsByArticle.get(article.id) || [] }));
}

function getArticleRow(id) {
  return database.prepare(`SELECT ${articleColumns} FROM articles WHERE articles.id = ?`).get(id);
}

export function getArticle(id) {
  const article = getArticleRow(id);
  return article ? attachLabels([article])[0] : null;
}

export function listArticles({ search = "", status = "all", labelId = null } = {}) {
  const conditions = [];
  const params = [];

  if (status !== "all") {
    conditions.push("articles.status = ?");
    params.push(status);
  }

  if (Number.isInteger(labelId) && labelId > 0) {
    conditions.push("EXISTS (SELECT 1 FROM article_labels filter_al WHERE filter_al.article_id = articles.id AND filter_al.label_id = ?)");
    params.push(labelId);
  }

  if (search.trim()) {
    conditions.push(`(
      articles.title LIKE ? OR articles.url LIKE ? OR articles.domain LIKE ? OR
      EXISTS (
        SELECT 1 FROM article_labels search_al
        JOIN labels search_l ON search_l.id = search_al.label_id
        WHERE search_al.article_id = articles.id AND search_l.name LIKE ?
      )
    )`);
    const query = `%${search.trim()}%`;
    params.push(query, query, query, query);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const articles = database
    .prepare(`SELECT ${articleColumns} FROM articles ${where} ORDER BY articles.created_at DESC, articles.id DESC`)
    .all(...params);

  const countRows = database.prepare("SELECT status, COUNT(*) AS count FROM articles GROUP BY status").all();
  const counts = { all: 0, unread: 0, reading: 0, completed: 0 };
  for (const row of countRows) {
    counts[row.status] = Number(row.count);
    counts.all += Number(row.count);
  }

  return { articles: attachLabels(articles), counts };
}

export function importArticles(items) {
  const normalizedItems = items.map((item) => ({
    ...item,
    labelIds: normalizeLabelIds(item.labelIds ?? []),
  }));
  const insert = database.prepare(`
    INSERT OR IGNORE INTO articles (title, url, domain, description, status)
    VALUES (?, ?, ?, ?, 'unread')
  `);
  const markManuallyLabeled = database.prepare(`
    UPDATE articles
    SET label_status = 'classified', label_error = NULL,
        labeled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `);
  const insertedIds = [];
  let duplicates = 0;

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const item of normalizedItems) {
      const result = insert.run(item.title, item.url, item.domain, String(item.description || "").slice(0, 2_000));
      if (Number(result.changes) === 1) {
        const articleId = Number(result.lastInsertRowid);
        insertedIds.push(articleId);
        if (item.labelIds.length) {
          replaceLabelsInTransaction(articleId, item.labelIds, "manual");
          markManuallyLabeled.run(articleId);
        }
      } else {
        duplicates += 1;
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return { inserted: insertedIds.map((id) => getArticle(id)), duplicates };
}

function normalizeLabelIds(labelIds, { requireAtLeastOne = false } = {}) {
  if (!Array.isArray(labelIds)) throw new Error("标签格式无效");
  const normalized = [...new Set(labelIds.map(Number))].filter((id) => Number.isInteger(id) && id > 0);
  if (requireAtLeastOne && normalized.length === 0) throw new Error("请至少选择一个标签");
  if (normalized.length > 5) throw new Error("每篇文章最多选择 5 个标签");
  if (normalized.length) {
    const placeholders = normalized.map(() => "?").join(", ");
    const count = Number(database.prepare(`SELECT COUNT(*) AS count FROM labels WHERE enabled = 1 AND id IN (${placeholders})`).get(...normalized).count);
    if (count !== normalized.length) throw new Error("包含不存在或已停用的标签");
  }
  return normalized;
}

function replaceLabelsInTransaction(articleId, labelIds, source, confidenceById = new Map()) {
  database.prepare("DELETE FROM article_labels WHERE article_id = ?").run(articleId);
  const insert = database.prepare(`
    INSERT INTO article_labels (article_id, label_id, source, confidence)
    VALUES (?, ?, ?, ?)
  `);
  for (const labelId of labelIds) insert.run(articleId, labelId, source, confidenceById.get(labelId) ?? null);
}

export function replaceArticleLabels(articleId, labelIds, source = "manual", confidenceById = new Map()) {
  const normalized = normalizeLabelIds(labelIds, { requireAtLeastOne: source === "llm" });
  if (!getArticleRow(articleId)) return null;
  database.exec("BEGIN IMMEDIATE");
  try {
    replaceLabelsInTransaction(articleId, normalized, source, confidenceById);
    database.prepare(`
      UPDATE articles
      SET label_status = 'classified', label_error = NULL,
          labeled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(articleId);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getArticle(articleId);
}

export function updateArticle(id, changes) {
  const fields = [];
  const params = [];
  const contentChanged = Object.hasOwn(changes, "title") || Object.hasOwn(changes, "url");

  if (typeof changes.title === "string") {
    const title = changes.title.trim();
    if (!title) throw new Error("标题不能为空");
    fields.push("title = ?");
    params.push(title.slice(0, 500));
  }

  if (typeof changes.status === "string") {
    if (!["unread", "reading", "completed"].includes(changes.status)) throw new Error("阅读状态无效");
    fields.push("status = ?");
    params.push(changes.status);
  }

  if (typeof changes.url === "string") {
    const duplicate = database.prepare("SELECT id FROM articles WHERE url = ? AND id <> ?").get(changes.url, id);
    if (duplicate) {
      const error = new Error("该链接已存在于阅读清单中");
      error.code = "DUPLICATE_URL";
      throw error;
    }
    fields.push("url = ?", "domain = ?");
    params.push(changes.url, changes.domain);
  }

  const hasLabels = Object.hasOwn(changes, "labelIds");
  const labelIds = hasLabels ? normalizeLabelIds(changes.labelIds) : null;
  if (!fields.length && !hasLabels) throw new Error("没有可更新的内容");
  if (!getArticleRow(id)) return null;

  database.exec("BEGIN IMMEDIATE");
  try {
    if (fields.length) {
      if (contentChanged && !hasLabels) fields.push("label_status = 'unclassified'", "label_error = NULL");
      fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
      database.prepare(`UPDATE articles SET ${fields.join(", ")} WHERE id = ?`).run(...params, id);
    }
    if (hasLabels) {
      replaceLabelsInTransaction(id, labelIds, "manual");
      database.prepare(`
        UPDATE articles SET label_status = ?, label_error = NULL,
          labeled_at = CASE WHEN ? = 'classified' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE labeled_at END,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
      `).run(labelIds.length ? "classified" : "unclassified", labelIds.length ? "classified" : "unclassified", id);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getArticle(id);
}

export function setArticleLabelingState(id, status, error = null) {
  const valid = new Set(["unclassified", "pending", "classified", "error"]);
  if (!valid.has(status)) throw new Error("分类状态无效");
  database.prepare(`
    UPDATE articles SET label_status = ?, label_error = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
  `).run(status, error ? String(error).slice(0, 1_000) : null, id);
}

export function listUnreadArticleIds({ onlyUnclassified = true } = {}) {
  const where = onlyUnclassified
    ? "status = 'unread' AND label_status IN ('unclassified', 'error')"
    : "status = 'unread'";
  return database.prepare(`SELECT id FROM articles WHERE ${where} ORDER BY created_at ASC`).all().map((row) => Number(row.id));
}

export function deleteArticle(id) {
  return Number(database.prepare("DELETE FROM articles WHERE id = ?").run(id).changes) === 1;
}

export function listLabels({ includeDisabled = false } = {}) {
  const where = includeDisabled ? "" : "WHERE l.enabled = 1";
  return database.prepare(`
    SELECT l.*, COUNT(al.article_id) AS article_count
    FROM labels l LEFT JOIN article_labels al ON al.label_id = l.id
    ${where}
    GROUP BY l.id
    ORDER BY l.enabled DESC,
      CASE l.group_name WHEN '主题' THEN 1 WHEN '系统' THEN 2 WHEN '框架' THEN 3 WHEN '内容类型' THEN 4 ELSE 5 END,
      l.name COLLATE NOCASE
  `).all().map(labelFromRow);
}

function normalizeLabelInput(input, existing = {}) {
  const name = String(input.name ?? existing.name ?? "").trim().slice(0, 40);
  if (!name) throw new Error("标签名称不能为空");
  const group = String(input.group ?? existing.group ?? "自定义").trim().slice(0, 30) || "自定义";
  const description = String(input.description ?? existing.description ?? "").trim().slice(0, 300);
  const aliases = Array.isArray(input.aliases)
    ? input.aliases.map((value) => String(value).trim()).filter(Boolean).slice(0, 12)
    : existing.aliases || [];
  const color = String(input.color ?? existing.color ?? "#5b5bd6");
  if (!/^#[0-9a-f]{6}$/iu.test(color)) throw new Error("标签颜色格式无效");
  return { name, group, description, aliases: [...new Set(aliases)], color };
}

function slugifyLabel(name) {
  const ascii = name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return ascii || `custom-${Date.now().toString(36)}`;
}

export function createLabel(input) {
  const label = normalizeLabelInput(input);
  let slug = slugifyLabel(label.name);
  let suffix = 1;
  while (database.prepare("SELECT 1 FROM labels WHERE slug = ?").get(slug)) {
    suffix += 1;
    slug = `${slugifyLabel(label.name)}-${suffix}`;
  }
  try {
    const result = database.prepare(`
      INSERT INTO labels (slug, name, group_name, description, aliases, color)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(slug, label.name, label.group, label.description, JSON.stringify(label.aliases), label.color);
    return listLabels({ includeDisabled: true }).find((item) => item.id === Number(result.lastInsertRowid));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) throw new Error("标签名称已存在");
    throw error;
  }
}

export function updateLabel(id, input) {
  const existing = listLabels({ includeDisabled: true }).find((item) => item.id === id);
  if (!existing) return null;
  const label = normalizeLabelInput(input, existing);
  const enabled = Object.hasOwn(input, "enabled") ? Boolean(input.enabled) : existing.enabled;
  try {
    database.prepare(`
      UPDATE labels SET name = ?, group_name = ?, description = ?, aliases = ?, color = ?, enabled = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
    `).run(label.name, label.group, label.description, JSON.stringify(label.aliases), label.color, enabled ? 1 : 0, id);
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) throw new Error("标签名称已存在");
    throw error;
  }
  return listLabels({ includeDisabled: true }).find((item) => item.id === id);
}

export function getRawSetting(key) {
  return database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value ?? null;
}

export function setRawSetting(key, value) {
  database.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).run(key, String(value));
}

export function getLlmSettings() {
  try {
    const stored = JSON.parse(getRawSetting("llm.settings") || "{}");
    return { ...DEFAULT_LLM_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_LLM_SETTINGS };
  }
}

export function updateLlmSettings(input) {
  const current = getLlmSettings();
  const next = {
    baseUrl: String(input.baseUrl ?? current.baseUrl).trim().replace(/\/+$/u, ""),
    model: String(input.model ?? current.model).trim().slice(0, 200),
    autoLabel: Object.hasOwn(input, "autoLabel") ? Boolean(input.autoLabel) : current.autoLabel,
    timeoutMs: Number(input.timeoutMs ?? current.timeoutMs),
    maxLabels: Number(input.maxLabels ?? current.maxLabels),
    subscriptionHeaderName: String(input.subscriptionHeaderName ?? current.subscriptionHeaderName).trim().slice(0, 100),
    userHeaderName: String(input.userHeaderName ?? current.userHeaderName).trim().slice(0, 100),
    userHeaderValue: String(input.userHeaderValue ?? current.userHeaderValue).trim().slice(0, 300),
  };
  let parsedUrl;
  try {
    parsedUrl = new URL(next.baseUrl);
  } catch {
    throw new Error("API Base URL 无效");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("API Base URL 只支持 HTTP 或 HTTPS");
  if (!Number.isInteger(next.timeoutMs) || next.timeoutMs < 3_000 || next.timeoutMs > 120_000) {
    throw new Error("请求超时时间应在 3 至 120 秒之间");
  }
  if (!Number.isInteger(next.maxLabels) || next.maxLabels < 1 || next.maxLabels > 5) {
    throw new Error("标签数量应在 1 至 5 个之间");
  }
  const reservedHeaders = new Set(["authorization", "content-length", "content-type", "host"]);
  for (const [field, value] of [
    ["订阅密钥请求头", next.subscriptionHeaderName],
    ["用户请求头", next.userHeaderName],
  ]) {
    if (value && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(value)) throw new Error(`${field}名称无效`);
    if (reservedHeaders.has(value.toLowerCase())) throw new Error(`${field}不能使用保留名称 ${value}`);
  }
  if (next.subscriptionHeaderName && next.userHeaderName
      && next.subscriptionHeaderName.toLowerCase() === next.userHeaderName.toLowerCase()) {
    throw new Error("订阅密钥请求头和用户请求头不能同名");
  }
  setRawSetting("llm.settings", JSON.stringify(next));
  return next;
}

function normalizeProxyUrl(value, allowedProtocols, label) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label}地址无效`);
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`${label}协议无效`);
  }
  if (!parsed.hostname || !parsed.port) throw new Error(`${label}必须包含主机和端口`);
  if (parsed.username || parsed.password) throw new Error(`${label}暂不支持在地址中保存用户名或密码`);
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error(`${label}不能包含路径、查询参数或片段`);
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function getNetworkSettings() {
  try {
    const stored = JSON.parse(getRawSetting("network.settings") || "{}");
    return { ...DEFAULT_NETWORK_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_NETWORK_SETTINGS };
  }
}

export function updateNetworkSettings(input) {
  const current = getNetworkSettings();
  const next = {
    useProxy: Object.hasOwn(input, "useProxy") ? Boolean(input.useProxy) : current.useProxy,
    httpProxy: normalizeProxyUrl(input.httpProxy ?? current.httpProxy, ["http:", "https:"], "HTTP 代理"),
    socksProxy: normalizeProxyUrl(input.socksProxy ?? current.socksProxy, ["socks5:"], "SOCKS5 代理"),
    fallbackToDirect: Object.hasOwn(input, "fallbackToDirect")
      ? Boolean(input.fallbackToDirect)
      : current.fallbackToDirect,
  };
  if (next.useProxy && !next.httpProxy && !next.socksProxy) {
    throw new Error("启用代理时请至少配置一个代理地址");
  }
  setRawSetting("network.settings", JSON.stringify(next));
  return next;
}

export function exportData() {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    articles: attachLabels(database.prepare(`SELECT ${articleColumns} FROM articles ORDER BY articles.created_at ASC, articles.id ASC`).all()),
    labels: listLabels({ includeDisabled: true }).map(({ source, confidence, ...label }) => label),
  };
}

export function closeDatabase() {
  database.close();
}

export { databasePath };
