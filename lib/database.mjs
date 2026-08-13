import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultDataDir = path.join(projectRoot, "data");
const databasePath = process.env.LEARNING_TRACKER_DB_PATH
  ? path.resolve(process.env.LEARNING_TRACKER_DB_PATH)
  : path.join(defaultDataDir, "reading-tracker.db");
const dataDir = path.dirname(databasePath);

mkdirSync(dataDir, { recursive: true });

export const database = new DatabaseSync(databasePath);

database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA busy_timeout = 5000");
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
`);

const articleColumns = `
  id,
  title,
  url,
  domain,
  status,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export function listArticles({ search = "", status = "all" } = {}) {
  const conditions = [];
  const params = [];

  if (status !== "all") {
    conditions.push("status = ?");
    params.push(status);
  }

  if (search.trim()) {
    conditions.push("(title LIKE ? OR url LIKE ? OR domain LIKE ?)");
    const query = `%${search.trim()}%`;
    params.push(query, query, query);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const articles = database
    .prepare(`SELECT ${articleColumns} FROM articles ${where} ORDER BY created_at DESC, id DESC`)
    .all(...params);

  const countRows = database
    .prepare("SELECT status, COUNT(*) AS count FROM articles GROUP BY status")
    .all();
  const counts = { all: 0, unread: 0, reading: 0, completed: 0 };

  for (const row of countRows) {
    counts[row.status] = Number(row.count);
    counts.all += Number(row.count);
  }

  return { articles, counts };
}

export function importArticles(items) {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO articles (title, url, domain, status)
    VALUES (?, ?, ?, 'unread')
  `);
  const findByUrl = database.prepare(`SELECT ${articleColumns} FROM articles WHERE url = ?`);
  const insertedIds = [];
  let duplicates = 0;

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const item of items) {
      const result = insert.run(item.title, item.url, item.domain);
      if (Number(result.changes) === 1) {
        insertedIds.push(Number(result.lastInsertRowid));
      } else {
        duplicates += 1;
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const inserted = insertedIds.map((id) =>
    database.prepare(`SELECT ${articleColumns} FROM articles WHERE id = ?`).get(id),
  );

  return { inserted, duplicates };
}

export function updateArticle(id, changes) {
  const fields = [];
  const params = [];

  if (typeof changes.title === "string") {
    const title = changes.title.trim();
    if (!title) throw new Error("标题不能为空");
    fields.push("title = ?");
    params.push(title.slice(0, 500));
  }

  if (typeof changes.status === "string") {
    if (!["unread", "reading", "completed"].includes(changes.status)) {
      throw new Error("阅读状态无效");
    }
    fields.push("status = ?");
    params.push(changes.status);
  }

  if (typeof changes.url === "string") {
    const duplicate = database
      .prepare("SELECT id FROM articles WHERE url = ? AND id <> ?")
      .get(changes.url, id);
    if (duplicate) {
      const error = new Error("该链接已存在于阅读清单中");
      error.code = "DUPLICATE_URL";
      throw error;
    }
    fields.push("url = ?", "domain = ?");
    params.push(changes.url, changes.domain);
  }

  if (!fields.length) throw new Error("没有可更新的内容");

  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  params.push(id);
  const result = database.prepare(`UPDATE articles SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  if (Number(result.changes) === 0) return null;
  return database.prepare(`SELECT ${articleColumns} FROM articles WHERE id = ?`).get(id);
}

export function deleteArticle(id) {
  return Number(database.prepare("DELETE FROM articles WHERE id = ?").run(id).changes) === 1;
}

export function exportArticles() {
  return database
    .prepare(`SELECT ${articleColumns} FROM articles ORDER BY created_at ASC, id ASC`)
    .all();
}

export function closeDatabase() {
  database.close();
}

export { databasePath };
