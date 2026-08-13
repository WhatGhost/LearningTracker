import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { extractTitleFromHtml, normalizeUrl, parseLinks } from "../lib/link-metadata.mjs";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let tempDir;
let testServer;
let closeDatabase;
let baseUrl;

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitUntilReady(url) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Test server did not become ready");
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { "content-type": "application/json", ...options.headers } : options.headers,
  });
  const body = await response.json();
  return { response, body };
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "learning-tracker-test-"));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  process.env.LEARNING_TRACKER_DB_PATH = path.join(tempDir, "test.db");
  const serverModule = await import(`../server.mjs?test=${Date.now()}`);
  const databaseModule = await import("../lib/database.mjs");
  testServer = serverModule.server;
  closeDatabase = databaseModule.closeDatabase;
  await new Promise((resolve, reject) => {
    testServer.once("error", reject);
    testServer.listen(port, "127.0.0.1", resolve);
  });
  await waitUntilReady(baseUrl);
});

after(async () => {
  if (testServer?.listening) {
    await new Promise((resolve) => testServer.close(resolve));
  }
  closeDatabase?.();
  delete process.env.LEARNING_TRACKER_DB_PATH;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

test("parses links, labels and duplicates", () => {
  const links = parseLinks(`
    https://example.com/first#section
    稍后阅读：https://example.com/second。
    duplicate https://example.com/first#section
    ftp://example.com/ignored
  `);

  assert.equal(links.length, 2);
  assert.equal(links[0].url, "https://example.com/first");
  assert.equal(links[1].url, "https://example.com/second");
  assert.equal(links[1].suppliedTitle, "稍后阅读");
  assert.throws(() => normalizeUrl("file:///etc/passwd"), /HTTP/);
});

test("extracts WeChat titles without accepting verification pages", () => {
  const html = `
    <html><head><title>微信公众平台</title></head>
    <body><script>var msg_title = '真正的文章\\u6807\\u9898'.html(false);</script></body></html>
  `;
  assert.equal(extractTitleFromHtml(html, "mp.weixin.qq.com"), "真正的文章标题");
  assert.equal(
    extractTitleFromHtml('<html><head><title>微信公众平台</title></head></html>', "mp.weixin.qq.com"),
    "",
  );
});

test("serves the reading list page", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /批量导入文章/u);
  assert.match(html, /article-body/u);
});

test("persists the full article lifecycle", async () => {
  const imported = await jsonRequest(`${baseUrl}/api/articles/import`, {
    method: "POST",
    body: JSON.stringify({
      items: [
        { title: "Example Article", url: "https://example.com/article#intro" },
        { title: "Duplicate Article", url: "https://example.com/article" },
      ],
    }),
  });
  assert.equal(imported.response.status, 201);
  assert.equal(imported.body.inserted.length, 1);
  assert.equal(imported.body.duplicates, 1);
  assert.equal(imported.body.inserted[0].status, "unread");

  const id = imported.body.inserted[0].id;
  const listed = await jsonRequest(`${baseUrl}/api/articles?status=unread&search=Example`);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.articles.length, 1);
  assert.deepEqual(listed.body.counts, { all: 1, unread: 1, reading: 0, completed: 0 });

  const updated = await jsonRequest(`${baseUrl}/api/articles/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Updated Article",
      url: "https://docs.example.com/updated#section",
      status: "completed",
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.article.title, "Updated Article");
  assert.equal(updated.body.article.url, "https://docs.example.com/updated");
  assert.equal(updated.body.article.domain, "docs.example.com");
  assert.equal(updated.body.article.status, "completed");

  const exported = await jsonRequest(`${baseUrl}/api/export`);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get("content-disposition"), /reading-tracker/u);
  assert.equal(exported.body.articles.length, 1);

  const deleted = await jsonRequest(`${baseUrl}/api/articles/${id}`, { method: "DELETE" });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.body.ok, true);

  const empty = await jsonRequest(`${baseUrl}/api/articles`);
  assert.equal(empty.body.counts.all, 0);
});

test("keeps the documented data path out of tracked source", async () => {
  const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^data\/$/mu);
  assert.match(gitignore, /^\*\.db-wal$/mu);
});
