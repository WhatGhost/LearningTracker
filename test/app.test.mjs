import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  extractTitleFromHtml,
  metadataHttpErrorMessage,
  normalizeUrl,
  parseLinks,
} from "../lib/link-metadata.mjs";

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

test("parses links without using surrounding text as titles", () => {
  const links = parseLinks(`
    https://example.com/first#section
    稍后阅读：https://example.com/second。
    duplicate https://example.com/first#section
    ftp://example.com/ignored
  `);

  assert.equal(links.length, 2);
  assert.equal(links[0].url, "https://example.com/first");
  assert.equal(links[1].url, "https://example.com/second");
  assert.equal(links[1].suppliedTitle, "");
  assert.throws(() => normalizeUrl("file:///etc/passwd"), /HTTP/);
});

test("parses nested Markdown links copied from chat exports", () => {
  const links = parseLinks(`
    Reader 09:40
    [机器人视频基座模型: [https://mp.weixin.qq.com/s?__biz=test#rd](https://mp.weixin.qq.com/s?__biz=test#rd)]
    Reader 15:37
    [谈谈 Kimi K3 的 KDA(1): [https://mp.weixin.qq.com/s/short](https://mp.weixin.qq.com/s/short)]
    Reader 15:38
    [[mp.weixin.qq.com](http://mp.weixin.qq.com): [https://mp.weixin.qq.com/s/no-title](https://mp.weixin.qq.com/s/no-title)]
  `);

  assert.deepEqual(links, [
    { url: "https://mp.weixin.qq.com/s?__biz=test", suppliedTitle: "" },
    { url: "https://mp.weixin.qq.com/s/short", suppliedTitle: "" },
    { url: "https://mp.weixin.qq.com/s/no-title", suppliedTitle: "" },
  ]);
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

test("explains Zhihu access verification failures", () => {
  assert.match(metadataHttpErrorMessage(403, "zhuanlan.zhihu.com"), /知乎返回了访问验证/u);
  assert.match(metadataHttpErrorMessage(403, "www.zhihu.com"), /手动填写标题并选择标签/u);
  assert.equal(metadataHttpErrorMessage(404, "example.com"), "网页返回 404");
});

test("serves the reading list page", async () => {
  const response = await fetch(baseUrl);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /批量导入文章/u);
  assert.match(html, /article-body/u);
  assert.match(html, /data-settings-tab="appearance"/u);
  assert.match(html, /name="app-theme" value="midnight"/u);
  assert.match(html, /name="app-theme" value="dracula"/u);
  assert.match(html, /name="app-theme" value="gruvbox"/u);
  assert.match(html, /标题与标签可在保存前修改/u);
  const styles = await (await fetch(`${baseUrl}/styles.css`)).text();
  assert.match(styles, /html\[data-color-scheme="dark"\] \.label-choice input:checked \+ span/u);
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

test("manages labels and attaches up to five labels to an article", async () => {
  const initial = await jsonRequest(`${baseUrl}/api/labels?includeDisabled=true`);
  assert.equal(initial.response.status, 200);
  assert.ok(initial.body.labels.some((label) => label.name === "PD 分离"));

  const createdLabel = await jsonRequest(`${baseUrl}/api/labels`, {
    method: "POST",
    body: JSON.stringify({
      name: "Attention",
      group: "主题",
      description: "注意力机制与实现",
      aliases: ["注意力"],
      color: "#123456",
    }),
  });
  assert.equal(createdLabel.response.status, 201);

  const imported = await jsonRequest(`${baseUrl}/api/articles/import`, {
    method: "POST",
    body: JSON.stringify({
      items: [{
        title: "Attention Article",
        url: "https://example.com/attention",
        labelIds: [createdLabel.body.label.id],
      }],
    }),
  });
  const articleId = imported.body.inserted[0].id;
  assert.deepEqual(imported.body.inserted[0].labels.map((label) => label.id), [createdLabel.body.label.id]);
  assert.equal(imported.body.inserted[0].labelStatus, "classified");
  const labelIds = initial.body.labels.filter((label) => label.enabled).slice(0, 4).map((label) => label.id);
  labelIds.push(createdLabel.body.label.id);

  const updated = await jsonRequest(`${baseUrl}/api/articles/${articleId}`, {
    method: "PATCH",
    body: JSON.stringify({ labelIds }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.article.labels.length, 5);
  assert.equal(updated.body.article.labelStatus, "classified");

  const tooMany = await jsonRequest(`${baseUrl}/api/articles/${articleId}`, {
    method: "PATCH",
    body: JSON.stringify({ labelIds: initial.body.labels.slice(0, 6).map((label) => label.id) }),
  });
  assert.equal(tooMany.response.status, 400);
  assert.match(tooMany.body.error, /最多选择 5 个/u);

  const filtered = await jsonRequest(`${baseUrl}/api/articles?label=${createdLabel.body.label.id}`);
  assert.equal(filtered.body.articles.length, 1);

  await jsonRequest(`${baseUrl}/api/articles/${articleId}`, { method: "DELETE" });
});

test("persists configurable direct and proxy modes for metadata fetching", async () => {
  const initial = await jsonRequest(`${baseUrl}/api/settings/network`);
  assert.equal(initial.response.status, 200);
  assert.equal(typeof initial.body.settings.useProxy, "boolean");
  assert.equal(initial.body.settings.httpProxy, "");
  assert.equal(initial.body.settings.socksProxy, "");
  assert.equal(initial.body.capabilities.socks5, false);

  const proxied = await jsonRequest(`${baseUrl}/api/settings/network`, {
    method: "PATCH",
    body: JSON.stringify({
      useProxy: true,
      httpProxy: "http://127.0.0.1:17890",
      socksProxy: "socks5://127.0.0.1:10801",
      fallbackToDirect: true,
    }),
  });
  assert.equal(proxied.response.status, 200);
  assert.deepEqual(proxied.body.settings, {
    useProxy: true,
    httpProxy: "http://127.0.0.1:17890",
    socksProxy: "socks5://127.0.0.1:10801",
    fallbackToDirect: true,
  });

  const invalid = await jsonRequest(`${baseUrl}/api/settings/network`, {
    method: "PATCH",
    body: JSON.stringify({ httpProxy: "socks5://127.0.0.1:10801" }),
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.body.error, /HTTP 代理协议无效/u);

  const direct = await jsonRequest(`${baseUrl}/api/settings/network`, {
    method: "PATCH",
    body: JSON.stringify({ useProxy: false }),
  });
  assert.equal(direct.body.settings.useProxy, false);
});

test("tests an OpenAI-compatible endpoint and auto-labels imported articles", async () => {
  const mockServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer local-test-key");
    assert.equal(request.headers["ocp-apim-subscription-key"], "local-subscription-key");
    assert.equal(request.headers.user, "test-user");
    assert.equal(body.model, "test-model");
    assert.equal(body.response_format?.json_schema?.schema?.properties?.labels?.uniqueItems, undefined);
    if (body.response_format?.type === "json_schema") {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Grammar error: Unimplemented keys: [\"maxItems\"]" } }));
      return;
    }
    assert.equal(body.response_format?.type, "json_object");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        labels: ["PD 分离", "vLLM"],
        needsReview: false,
        reason: "文章聚焦 vLLM 的 PD 分离。",
      }) } }],
    }));
  });
  const mockPort = await availablePort();
  await new Promise((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(mockPort, "127.0.0.1", resolve);
  });

  try {
    const saved = await jsonRequest(`${baseUrl}/api/settings/llm`, {
      method: "PATCH",
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockPort}/v1`,
        model: "test-model",
        apiKey: "local-test-key",
        subscriptionHeaderName: "Ocp-Apim-Subscription-Key",
        subscriptionKey: "local-subscription-key",
        userHeaderName: "user",
        userHeaderValue: "test-user",
        autoLabel: true,
        timeoutMs: 10_000,
        maxLabels: 5,
      }),
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.apiKey.configured, true);
    assert.equal(saved.body.apiKey.persistent, false);
    assert.equal(saved.body.subscriptionKey.configured, true);
    assert.equal(saved.body.subscriptionKey.persistent, false);

    const connection = await jsonRequest(`${baseUrl}/api/settings/llm/test`, { method: "POST" });
    assert.equal(connection.response.status, 200);
    assert.deepEqual(connection.body.labels, ["PD 分离", "vLLM"]);

    const imported = await jsonRequest(`${baseUrl}/api/articles/import`, {
      method: "POST",
      body: JSON.stringify({
        items: [{
          title: "vLLM 的 Prefill/Decode 分离实践",
          url: "https://example.com/vllm-pd",
          description: "PD 分离和推理吞吐优化",
        }],
      }),
    });
    assert.equal(imported.body.classificationQueued, 1);
    const articleId = imported.body.inserted[0].id;

    let article;
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const listed = await jsonRequest(`${baseUrl}/api/articles?search=Prefill`);
      article = listed.body.articles[0];
      if (article?.labelStatus === "classified") break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(article.labelStatus, "classified");
    assert.deepEqual(article.labels.map((label) => label.name), ["vLLM", "PD 分离"]);

    const exported = await jsonRequest(`${baseUrl}/api/export`);
    assert.equal(JSON.stringify(exported.body).includes("local-test-key"), false);
    assert.equal(JSON.stringify(exported.body).includes("local-subscription-key"), false);
    await jsonRequest(`${baseUrl}/api/articles/${articleId}`, { method: "DELETE" });
  } finally {
    await new Promise((resolve) => mockServer.close(resolve));
  }
});

test("keeps the documented data path out of tracked source", async () => {
  const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /^data\/$/mu);
  assert.match(gitignore, /^\*\.db-wal$/mu);
  assert.match(gitignore, /^reading-tracker-\*\.json$/mu);
  assert.match(gitignore, /^\.npmrc$/mu);
  assert.match(gitignore, /^PRIVATE_RELEASE_CHECKLIST\.md$/mu);
  const license = await readFile(path.join(projectRoot, "LICENSE"), "utf8");
  assert.match(license, /^MIT License$/mu);
  assert.match(license, /Copyright \(c\) 2026 WhatGhost/u);
  const englishReadme = await readFile(path.join(projectRoot, "README_EN.md"), "utf8");
  assert.match(englishReadme, /href="README\.md">简体中文<\/a>/u);
  const chineseReadme = await readFile(path.join(projectRoot, "README.md"), "utf8");
  assert.match(chineseReadme, /href="README_EN\.md"/u);
});
