import dns from "node:dns/promises";
import net from "node:net";

const MAX_LINKS = 50;
const MAX_HTML_BYTES = 768 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
const WECHAT_FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 4;
let requestFetch = globalThis.fetch;

export function configureMetadataFetch(fetchImplementation) {
  if (typeof fetchImplementation !== "function") throw new TypeError("fetchImplementation must be a function");
  requestFetch = fetchImplementation;
}

export function normalizeUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("只支持 HTTP 或 HTTPS 链接");
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.href;
}

function trimUrlPunctuation(value) {
  return value.replace(/[.,;:!?，。；：！？、）】》」』]+$/gu, "");
}

export function parseLinks(input) {
  const results = [];
  const seen = new Set();

  for (const line of String(input).split(/\r?\n/u)) {
    const matches = line.match(/https?:\/\/[^\s<>"']+/giu) || [];
    for (const match of matches) {
      try {
        const url = normalizeUrl(trimUrlPunctuation(match));
        if (seen.has(url)) continue;
        seen.add(url);
        const suppliedTitle = line.replace(match, "").replace(/^[\s\-—–|｜:：]+|[\s\-—–|｜:：]+$/gu, "").trim();
        results.push({ url, suppliedTitle: suppliedTitle.slice(0, 500) });
        if (results.length >= MAX_LINKS) return results;
      } catch {
        // Skip malformed URL candidates while preserving the valid lines.
      }
    }
  }

  return results;
}

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

async function assertPublicUrl(value) {
  const url = new URL(value);
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) {
    throw new Error("不允许访问本机地址");
  }
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("不允许访问内网地址");
  }
}

async function readHtml(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let html = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
    html += decoder.decode(value, { stream: true });
    if (/<\/head\s*>/iu.test(html)) {
      await reader.cancel();
      break;
    }
  }

  return html + decoder.decode();
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/giu, (entity, name) => named[name.toLowerCase()] ?? entity)
    .replace(/\s+/gu, " ")
    .trim();
}

function decodeJavascriptString(value) {
  const escapedCharacters = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
  };
  return value
    .replace(/\\u\{([0-9a-f]+)\}/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\\u([0-9a-f]{4})/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\\x([0-9a-f]{2})/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\\([bfnrtv])/gu, (_, code) => escapedCharacters[code] ?? code)
    .replace(/\\([\\"'])/gu, "$1");
}

function readMetaTitle(html) {
  const metaTags = html.match(/<meta\b[^>]*>/giu) || [];
  for (const tag of metaTags) {
    const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/iu)?.[1]?.toLowerCase();
    if (!["og:title", "twitter:title"].includes(key)) continue;
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/iu)?.[1];
    if (content) return decodeEntities(content);
  }
  return null;
}

function readWechatTitle(html) {
  const match = html.match(/\bmsg_title\s*=\s*(["'])((?:\\.|(?!\1)[\s\S])*)\1/iu);
  return match ? decodeEntities(decodeJavascriptString(match[2])) : null;
}

export function extractTitleFromHtml(html, hostname = "") {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu);
  const isWechat = hostname === "mp.weixin.qq.com" || hostname.endsWith(".mp.weixin.qq.com");
  const candidates = [
    readMetaTitle(html),
    isWechat ? readWechatTitle(html) : null,
    titleMatch ? decodeEntities(titleMatch[1]) : null,
  ];
  const genericWechatTitles = new Set([
    "微信公众平台",
    "微信公众平台安全助手",
    "环境异常",
    "Weixin Official Accounts Platform",
  ]);

  for (const candidate of candidates) {
    const title = candidate?.replace(/\s+/gu, " ").trim();
    if (!title) continue;
    if (isWechat && genericWechatTitles.has(title)) continue;
    return title.slice(0, 500);
  }
  return "";
}

function requestOptionsFor(url) {
  const isWechat = url.hostname === "mp.weixin.qq.com" || url.hostname.endsWith(".mp.weixin.qq.com");
  return {
    timeout: isWechat ? WECHAT_FETCH_TIMEOUT_MS : DEFAULT_FETCH_TIMEOUT_MS,
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
      "Cache-Control": "no-cache",
      "User-Agent": isWechat
        ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        : "Mozilla/5.0 (compatible; LearningTracker/1.0; local title fetcher)",
      ...(isWechat ? { Referer: "https://mp.weixin.qq.com/" } : {}),
    },
  };
}

async function fetchWithHardTimeout(url, options) {
  let timeoutId;
  const timeoutError = new Error(`请求在 ${Math.round(options.timeout / 1_000)} 秒后超时`);
  timeoutError.name = "TimeoutError";
  try {
    return await Promise.race([
      requestFetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeout),
        headers: options.headers,
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(timeoutError), options.timeout + 250);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchHtml(startUrl) {
  let currentUrl = startUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicUrl(currentUrl);
    const parsedUrl = new URL(currentUrl);
    const options = requestOptionsFor(parsedUrl);
    const response = await fetchWithHardTimeout(currentUrl, options);

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("网页重定向无效");
      currentUrl = normalizeUrl(new URL(location, currentUrl).href);
      continue;
    }

    if (!response.ok) throw new Error(`网页返回 ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("链接不是网页内容");
    }
    return { html: await readHtml(response), finalUrl: currentUrl };
  }

  throw new Error("网页重定向次数过多");
}

export async function fetchLinkMetadata(item) {
  const url = normalizeUrl(item.url);
  const parsed = new URL(url);
  const domain = parsed.hostname.replace(/^www\./u, "");

  try {
    const { html, finalUrl } = await fetchHtml(url);
    const title = extractTitleFromHtml(html, parsed.hostname);
    return {
      url,
      finalUrl,
      domain,
      title: title || item.suppliedTitle || domain,
      fetched: Boolean(title),
      errorType: title ? null : "title_missing",
      error: title
        ? null
        : parsed.hostname === "mp.weixin.qq.com"
          ? "微信页面未返回文章标题，可能触发了访问验证，请手动确认"
          : "未找到网页标题，请手动确认",
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || String(error?.message).toLowerCase().includes("timeout");
    const message =
      parsed.hostname === "mp.weixin.qq.com" && timedOut
        ? "微信页面响应超时（已等待 20 秒），请稍后重试或手动填写标题"
        : error instanceof Error
          ? error.message
          : "标题抓取失败";
    return {
      url,
      finalUrl: url,
      domain,
      title: item.suppliedTitle || domain,
      fetched: false,
      errorType: timedOut ? "timeout" : "network",
      error: message,
    };
  }
}

export async function fetchMetadataBatch(items, concurrency = 5) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fetchLinkMetadata(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
