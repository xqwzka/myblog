const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const MarkdownIt = require("markdown-it");
const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (!key) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    value = value.replace(/\\n/g, "\n");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function readPositiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

loadEnvFile();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const DB_PATH = path.join(__dirname, "data", "db.json");
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
const ALLOWED_CONTENT_TYPES = new Set(["rich", "markdown", "html", "text"]);
const AI_BASE_URL = String(
  process.env.IMPORT_AI_BASE_URL || process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL || "https://api.azk.us.ci/v1"
).trim().replace(/\/+$/, "");
const AI_API_KEY = String(
  process.env.IMPORT_AI_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_API_KEY || ""
).trim();
const AI_MODEL = String(
  process.env.IMPORT_AI_MODEL || process.env.OPENAI_MODEL || process.env.AI_MODEL || "gpt-5"
).trim() || "gpt-5";
const MAX_AI_HTML_CHARS = readPositiveNumber(process.env.IMPORT_AI_MAX_HTML_CHARS, 30000);
const MAX_AI_TEXT_CHARS = readPositiveNumber(process.env.IMPORT_AI_MAX_TEXT_CHARS, 10000);
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");
const ADMIN_SESSION_COOKIE = "admin_session";
const ADMIN_SESSION_SECRET = String(process.env.ADMIN_SESSION_SECRET || `${ADMIN_USERNAME}:${ADMIN_PASSWORD}:maomao`).trim();
const NOISE_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "dialog",
  "[role='navigation']",
  "[role='complementary']",
  ".comments",
  "#comments",
  "[class*='comment']",
  "[id*='comment']",
  ".sidebar",
  "[class*='sidebar']",
  ".related",
  "[class*='related']",
  ".recommend",
  "[class*='recommend']",
  ".share",
  "[class*='share']",
  ".breadcrumb",
  "[class*='breadcrumb']",
  ".pagination",
  "[class*='pagination']",
  ".newsletter",
  "[class*='newsletter']",
  ".advertisement",
  "[class*='advert']",
  "[class*='promo']",
  "[class*='cookie']",
  "[class*='popup']",
  "[class*='modal']"
];

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: true
});

const defaultSettings = {
  siteName: "内容发布站",
  homeTitle: "分类文章展示台",
  homeSubtitle: "点击标题可进入文章详情，右下角切换模块/列表视图。"
};

const seedData = {
  settings: {
    ...defaultSettings,
    ai: {
      baseUrl: AI_BASE_URL,
      apiKey: AI_API_KEY,
      model: AI_MODEL
    }
  },
  categories: [
    { id: "cat-1", name: "教程", createdAt: "2026-03-24T12:00:00.000Z" },
    { id: "cat-2", name: "工具", createdAt: "2026-03-24T12:01:00.000Z" },
    { id: "cat-3", name: "说明", createdAt: "2026-03-24T12:02:00.000Z" }
  ],
  articles: [
    {
      id: "art-1",
      title: "软件下载页搭建清单",
      intro: "展示应用名称、版本、下载地址和更新记录。",
      sourceUrl: "",
      contentType: "rich",
      content: "<p>这是富文本示例。</p><p><strong>支持</strong>：标题、列表、引用、图片、代码块。</p><pre><code class=\"language-js\">console.log('rich text');</code></pre>",
      categoryId: "cat-1",
      createdAt: "2026-03-24T12:10:00.000Z",
      updatedAt: "2026-03-24T12:10:00.000Z"
    },
    {
      id: "art-2",
      title: "后台表单模块规范",
      intro: "统一字段结构、提示文案和错误处理。",
      sourceUrl: "",
      contentType: "markdown",
      content: "## Markdown 示例\n\n~~~html\n<div class=\"card\">hello</div>\n~~~\n\n- 支持列表\n- 支持代码\n- 支持表格\n",
      categoryId: "cat-2",
      createdAt: "2026-03-24T12:12:00.000Z",
      updatedAt: "2026-03-24T12:12:00.000Z"
    },
    {
      id: "art-3",
      title: "部署前检查事项",
      intro: "记录 Nginx、HTTPS、数据库账号和发布步骤。",
      sourceUrl: "",
      contentType: "html",
      content: "<h3>HTML 示例</h3><p>你可以直接编写 HTML 结构。</p><pre><code>&lt;meta charset=&quot;UTF-8&quot; /&gt;</code></pre><blockquote>发布前请先备份。</blockquote>",
      categoryId: "cat-3",
      createdAt: "2026-03-24T12:14:00.000Z",
      updatedAt: "2026-03-24T12:14:00.000Z"
    }
  ]
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if ((file.mimetype || "").startsWith("image/")) return cb(null, true);
    cb(new Error("只支持图片上传"));
  }
});

function ensureFoldersAndDb() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(seedData, null, 2), "utf8");
    return;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.articles)) {
      throw new Error("schema");
    }
  } catch (_) {
    fs.writeFileSync(DB_PATH, JSON.stringify(seedData, null, 2), "utf8");
  }
}

function normalizeAiSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const baseUrl = String(source.baseUrl || source.aiBaseUrl || AI_BASE_URL || "").trim().replace(/\/+$/, "") || AI_BASE_URL;
  const apiKey = String(source.apiKey || source.aiApiKey || AI_API_KEY || "").trim();
  const model = String(source.model || source.aiModel || AI_MODEL || "gpt-5.4").trim() || AI_MODEL || "gpt-5.4";
  return { baseUrl, apiKey, model };
}

function normalizeSettings(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const siteName = String(source.siteName || "").trim() || defaultSettings.siteName;
  const homeTitle = String(source.homeTitle || "").trim() || defaultSettings.homeTitle;
  const homeSubtitle = String(source.homeSubtitle || "").trim() || defaultSettings.homeSubtitle;
  const settings = { siteName, homeTitle, homeSubtitle };
  if (options.includePrivate) {
    settings.ai = normalizeAiSettings(source.ai && typeof source.ai === "object" ? source.ai : source);
  }
  return settings;
}

function getPublicSettings(settings) {
  const normalized = normalizeSettings(settings);
  return {
    siteName: normalized.siteName,
    homeTitle: normalized.homeTitle,
    homeSubtitle: normalized.homeSubtitle
  };
}

function getAiImportConfig(settings) {
  return normalizeSettings(settings, { includePrivate: true }).ai;
}

function normalizeContentType(value) {
  const type = String(value || "").trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(type) ? type : "rich";
}

function normalizeArticle(article) {
  return {
    ...article,
    title: String(article?.title || ""),
    intro: String(article?.intro ?? article?.summary ?? ""),
    sourceUrl: String(article?.sourceUrl || ""),
    contentType: normalizeContentType(article?.contentType),
    content: String(article?.content ?? ""),
    createdAt: String(article?.createdAt || new Date().toISOString()),
    updatedAt: String(article?.updatedAt || article?.createdAt || new Date().toISOString())
  };
}

function readDb() {
  const raw = fs.readFileSync(DB_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return {
    settings: normalizeSettings(parsed.settings, { includePrivate: true }),
    categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    articles: Array.isArray(parsed.articles) ? parsed.articles.map(normalizeArticle) : []
  };
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortByCreatedAtDesc(items) {
  return [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderArticleContent(article) {
  const contentType = normalizeContentType(article?.contentType);
  const raw = String(article?.content ?? "");
  if (contentType === "markdown") return md.render(raw || "暂无正文内容。");
  if (contentType === "text") {
    const safe = escapeHtml(raw);
    return safe.trim() ? `<pre><code>${safe}</code></pre>` : "<p>暂无正文内容。</p>";
  }
  if (!raw.trim()) return "<p>暂无正文内容。</p>";
  return raw;
}

function withCategoryName(article, categories) {
  const normalized = normalizeArticle(article);
  const category = categories.find((c) => c.id === normalized.categoryId);
  return {
    ...normalized,
    renderedContent: renderArticleContent(normalized),
    categoryName: category ? category.name : "未分类"
  };
}

function isBlockedHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function absolutizeRichHtml(html, baseUrl) {
  const dom = new JSDOM(`<body>${html}</body>`, { url: baseUrl });
  const doc = dom.window.document;
  doc.querySelectorAll("script, style").forEach((el) => el.remove());

  doc.querySelectorAll("[src]").forEach((el) => {
    const value = el.getAttribute("src");
    if (!value) return;
    try { el.setAttribute("src", new URL(value, baseUrl).href); } catch (_) {}
  });

  doc.querySelectorAll("[href]").forEach((el) => {
    const value = el.getAttribute("href");
    if (!value) return;
    try { el.setAttribute("href", new URL(value, baseUrl).href); } catch (_) {}
  });

  return doc.body.innerHTML;
}

function plainTextFromHtml(html) {
  const dom = new JSDOM(`<body>${html}</body>`);
  const text = dom.window.document.body.textContent || "";
  return text.replace(/\s+/g, " ").trim();
}

function getMetaContent(doc, selector) {
  const node = doc.querySelector(selector);
  return node ? String(node.getAttribute("content") || "").trim() : "";
}

function trimToLength(value, maxChars, suffix = "\n<!-- truncated -->") {
  const text = String(value || "").trim();
  if (!text || text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd() + suffix;
}

function removeCommentNodes(root) {
  if (!root) return;
  const doc = root.ownerDocument || root;
  const view = doc.defaultView;
  if (!view) return;

  const walker = doc.createTreeWalker(root, view.NodeFilter.SHOW_COMMENT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => node.parentNode && node.parentNode.removeChild(node));
}

function removeNoiseNodes(doc) {
  doc.querySelectorAll("script, style, noscript, iframe, frame, frameset, template, svg, canvas, dialog, input, textarea, select, button").forEach((el) => el.remove());
  for (const selector of NOISE_SELECTORS) {
    doc.querySelectorAll(selector).forEach((el) => el.remove());
  }
  removeCommentNodes(doc);
}

function stripUnsafeAttributes(doc) {
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = String(attr.name || "").toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if (["srcset", "loading", "decoding", "fetchpriority", "style"].includes(name)) {
        el.removeAttribute(attr.name);
      }
    });
  });
}

function normalizeHrefValue(value, baseUrl) {
  try {
    const target = new URL(value, baseUrl);
    if (["http:", "https:"].includes(target.protocol)) return target.href;
  } catch (_) {}
  return "";
}

function normalizeSrcValue(value, baseUrl) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/")) return raw;
  return normalizeHrefValue(raw, baseUrl);
}

function extractBlockTextPreserveBreaks(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
  return String(clone.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countChineseChars(text) {
  return (String(text || "").match(/[\u3400-\u9fff]/g) || []).length;
}

function countCodeChars(text) {
  return (String(text || "").match(/[A-Za-z0-9_$#./:=<>{}\[\]()\-`]/g) || []).length;
}

function isStrongCodeLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;

  return /^(?:[$#>]\s*)?(?:npm|pnpm|yarn|npx|node|python(?:3)?|pip(?:3)?|uv|poetry|go|cargo|git|curl|wget|apt(?:-get)?|brew|yum|dnf|apk|docker(?:-compose)?|kubectl|helm|pm2|systemctl|service|ssh|scp|rsync|chmod|chown|mkdir|cd|cp|mv|rm|cat|echo|export|set|sed|awk|grep|find|tar|zip|unzip|composer|php|java|javac|mvn|gradle|nginx|mysql|psql|redis-cli|mongosh)\b/i.test(text)
    || /^(?:[A-Z_][A-Z0-9_]*=.*)$/.test(text)
    || /^<\/?[a-z][^>]*>$/i.test(text)
    || /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE)\b/i.test(text)
    || /=>|::|===|&&|\|\||\{\s*$/.test(text)
    || /^[\[{].*[\]}]$/.test(text);
}

function isLikelyCodeBlockText(text) {
  const lines = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;

  const strongCount = lines.filter(isStrongCodeLine).length;
  const chineseChars = countChineseChars(text);
  const codeChars = countCodeChars(text);
  const hasChinesePunctuation = /[。！？；，]$/.test(lines[lines.length - 1] || "");

  if (lines.length === 1) {
    return strongCount === 1 && !hasChinesePunctuation && (codeChars > chineseChars || /^[#$>]/.test(lines[0]));
  }

  return strongCount >= Math.max(1, Math.ceil(lines.length / 2))
    || (strongCount >= 1 && codeChars > chineseChars * 1.2 && !hasChinesePunctuation);
}

function isConvertibleCodeElement(element) {
  if (!element || !["P", "DIV"].includes(element.tagName)) return false;
  if (element.closest("pre, code, table, blockquote")) return false;
  if (element.querySelector("pre, table, img, blockquote, ul, ol, h1, h2, h3, h4, h5, h6")) return false;

  const text = extractBlockTextPreserveBreaks(element);
  if (!text || text.length < 3) return false;
  return isLikelyCodeBlockText(text);
}

function createCodeBlockElement(doc, text) {
  const pre = doc.createElement("pre");
  const code = doc.createElement("code");
  code.textContent = text;
  pre.appendChild(code);
  return pre;
}

function promoteLikelyCodeBlocks(doc) {
  doc.querySelectorAll("pre code").forEach((code) => {
    code.textContent = String(code.textContent || "").replace(/\u00a0/g, " ");
  });

  doc.querySelectorAll("body, article, section, main, .content, .post-content, .article-content, .entry-content").forEach((parent) => {
    let children = [...parent.children];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!isConvertibleCodeElement(child)) continue;

      const group = [child];
      const texts = [extractBlockTextPreserveBreaks(child)];
      let j = i + 1;
      while (j < children.length && isConvertibleCodeElement(children[j])) {
        group.push(children[j]);
        texts.push(extractBlockTextPreserveBreaks(children[j]));
        j += 1;
      }

      const codeText = texts.join("\n").trim();
      if (!isLikelyCodeBlockText(codeText)) continue;

      const pre = createCodeBlockElement(doc, codeText);
      group[0].before(pre);
      group.forEach((node) => node.remove());
      children = [...parent.children];
    }
  });
}

function pickLargestContentBlock(doc) {
  const selectors = [
    "article",
    "main",
    "[role='main']",
    ".article-content",
    ".article-body",
    ".post-content",
    ".post-body",
    ".entry-content",
    ".markdown-body",
    ".content-body",
    ".rich-text",
    ".richtext",
    ".doc-content",
    ".article",
    ".post"
  ];

  let bestHtml = "";
  for (const selector of selectors) {
    doc.querySelectorAll(selector).forEach((el) => {
      const html = String(el.innerHTML || "").trim();
      if (html.length > bestHtml.length) bestHtml = html;
    });
  }

  if (!bestHtml && doc.body) {
    bestHtml = String(doc.body.innerHTML || "").trim();
  }
  return bestHtml;
}

function sanitizeImportedHtml(html, baseUrl) {
  if (!String(html || "").trim()) return "";

  const dom = new JSDOM(`<body>${html}</body>`, { url: baseUrl });
  const doc = dom.window.document;

  removeNoiseNodes(doc);
  stripUnsafeAttributes(doc);

  doc.querySelectorAll("[src]").forEach((el) => {
    const normalized = normalizeSrcValue(el.getAttribute("src"), baseUrl);
    if (normalized) el.setAttribute("src", normalized);
    else el.removeAttribute("src");
  });

  doc.querySelectorAll("[href]").forEach((el) => {
    const normalized = normalizeHrefValue(el.getAttribute("href"), baseUrl);
    if (normalized) el.setAttribute("href", normalized);
    else el.removeAttribute("href");
  });

  promoteLikelyCodeBlocks(doc);
  return String(doc.body.innerHTML || "").trim();
}

async function fetchHtmlForImport(targetUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) throw new Error("抓取失败：" + response.status);

    const finalUrl = new URL(response.url || targetUrl.toString());
    if (isBlockedHostname(finalUrl.hostname)) throw new Error("目标地址不允许抓取");

    const html = await response.text();
    if (!String(html || "").trim()) throw new Error("抓取到的页面为空");

    return { finalUrl, html };
  } finally {
    clearTimeout(timer);
  }
}

function buildImportCandidates(html, finalUrl) {
  const sourceUrl = finalUrl.toString();

  const metaDom = new JSDOM(html, { url: sourceUrl });
  const metaDoc = metaDom.window.document;
  const documentTitle = String(metaDoc.title || "").trim();
  const metaDescription = getMetaContent(
    metaDoc,
    'meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]'
  );

  const readabilityDom = new JSDOM(html, { url: sourceUrl });
  const reader = new Readability(readabilityDom.window.document);
  const parsed = reader.parse() || {};
  const readabilityTitle = String(parsed.title || documentTitle || "").trim();
  const readabilityExcerpt = String(parsed.excerpt || metaDescription || "").trim();
  const readabilityHtml = parsed.content
    ? trimToLength(
        sanitizeImportedHtml(absolutizeRichHtml(parsed.content, sourceUrl), sourceUrl),
        MAX_AI_HTML_CHARS
      )
    : "";

  const mainDom = new JSDOM(html, { url: sourceUrl });
  const mainDoc = mainDom.window.document;
  removeNoiseNodes(mainDoc);
  stripUnsafeAttributes(mainDoc);
  const mainHtml = trimToLength(
    sanitizeImportedHtml(absolutizeRichHtml(pickLargestContentBlock(mainDoc), sourceUrl), sourceUrl),
    MAX_AI_HTML_CHARS
  );

  const textExcerpt = trimToLength(
    plainTextFromHtml(readabilityHtml || mainHtml),
    MAX_AI_TEXT_CHARS,
    " …"
  );

  return {
    finalUrl,
    documentTitle,
    metaDescription,
    readabilityTitle,
    readabilityExcerpt,
    readabilityHtml,
    mainHtml,
    textExcerpt
  };
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("AI 未返回内容");

  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.unshift(fenced[1].trim());

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_) {}
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }

  throw new Error("AI 返回的内容不是有效 JSON");
}

function readChatTextFromResponse(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item.text === "string") return item.text;
      return "";
    }).join("\n");
  }

  if (typeof data?.output_text === "string") return data.output_text;

  if (Array.isArray(data?.output)) {
    return data.output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).map((part) => {
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    }).join("\n");
  }

  return "";
}

function normalizeAiImportResult(payload, sourceUrl, fallbackTitle = "") {
  const title = String(payload?.title || fallbackTitle || "").trim();
  const introRaw = String(payload?.intro || payload?.summary || "").trim();

  let contentHtml = String(payload?.contentHtml || payload?.content || payload?.html || "").trim();
  if (!contentHtml && payload?.contentMarkdown) {
    contentHtml = md.render(String(payload.contentMarkdown || ""));
  }

  contentHtml = sanitizeImportedHtml(contentHtml, sourceUrl);

  if (!title) throw new Error("AI 未提取到文章标题");
  if (!contentHtml || plainTextFromHtml(contentHtml).length < 20) {
    throw new Error("AI 未提取到足够的正文内容");
  }

  const intro = (introRaw || plainTextFromHtml(contentHtml).slice(0, 220)).slice(0, 220);
  return {
    title,
    intro,
    sourceUrl,
    contentType: "rich",
    content: contentHtml
  };
}

async function extractImportPayloadWithAi(page, aiConfig) {
  const runtimeAi = normalizeAiSettings(aiConfig);
  if (!runtimeAi.apiKey) throw new Error("AI 抓取未配置 API Key");

  const prompt = [
    `目标链接：${page.finalUrl.toString()}`,
    `页面标题：${page.documentTitle || "（空）"}`,
    `Meta 描述：${page.metaDescription || "（空）"}`,
    `Readability 标题：${page.readabilityTitle || "（空）"}`,
    `Readability 摘要：${page.readabilityExcerpt || "（空）"}`,
    "",
    "任务：请只提取这个网页中真正的文章/教程主体。",
    "严格要求：",
    "1. 只保留正文需要的标题和内容。",
    "2. 不要抓取评论区、相关推荐、导航、侧边栏、页脚、面包屑、广告、分享按钮、登录提示、作者卡片、下载按钮、站点模板结构。",
    "3. 如果页面像论坛、社区帖子或问答页，只保留楼主主帖正文，不要带上后续评论和楼层回复。",
    "4. 教程里的命令行、配置片段、JSON、YAML、XML、HTML、JS、Shell、终端输出等可复制内容，必须尽量转成 <pre><code>...</code></pre> 代码块，不要混在普通段落里。",
    "5. 如果正文里有标题、段落、列表、代码块、引用、表格、图片、链接，请尽量保留为 HTML。",
    "6. 保持原文语言，不要翻译，不要扩写，不要总结成长文。",
    "7. intro 只写 1-2 句简短简介；如果页面没有明显简介，就根据正文提炼一句。",
    "8. 输出必须是 JSON，不要代码块，不要解释，不要额外字段。",
    "",
    "输出 JSON 结构：",
    '{"title":"...","intro":"...","contentHtml":"<h2>...</h2><p>...</p>"}',
    "",
    "候选正文 HTML（优先参考）：",
    page.readabilityHtml || "（空）",
    "",
    "候选正文 HTML（备用参考）：",
    page.mainHtml || "（空）",
    "",
    "候选镜像 Markdown（论坛/社区兜底参考）：",
    page.mirrorMarkdown || "（空）",
    "",
    "候选纯文本摘录：",
    page.textExcerpt || "（空）"
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${runtimeAi.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${runtimeAi.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: runtimeAi.model,
        reasoning: { effort: "minimal" },
        messages: [
          {
            role: "system",
            content: "You extract only the main article/tutorial body from webpages. Return valid JSON only. Exclude navigation, comments, related posts, ads, footers, sidebars, author cards, share widgets, and other site chrome."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`AI 接口调用失败：${response.status}${errorText ? ` ${errorText.slice(0, 240)}` : ""}`);
    }

    const data = await response.json();
    const text = readChatTextFromResponse(data);
    const parsed = extractJsonObject(text);
    return normalizeAiImportResult(parsed, page.finalUrl.toString(), page.readabilityTitle || page.documentTitle);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchImportPayload(targetUrl) {
  const { finalUrl, html } = await fetchHtmlForImport(targetUrl);
  const page = buildImportCandidates(html, finalUrl);
  const contentHtml = page.readabilityHtml || page.mainHtml;
  if (!contentHtml) throw new Error("未抓取到正文内容");

  const intro = String(page.readabilityExcerpt || plainTextFromHtml(contentHtml).slice(0, 220)).trim().slice(0, 220);
  return {
    title: page.readabilityTitle || page.documentTitle || "未命名文章",
    intro,
    sourceUrl: finalUrl.toString(),
    contentType: "rich",
    content: contentHtml
  };
}

function extractPrimaryMarkdownFromMirror(markdown, title = "") {
  const raw = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const lines = raw.split("\n");
  let start = 0;
  const floorZeroIndex = lines.findIndex((line) => /\[#0\]\(/.test(line));
  if (floorZeroIndex >= 0) {
    start = floorZeroIndex + 1;
  }

  while (start < lines.length && !String(lines[start] || "").trim()) start += 1;

  const endPatterns = [
    /\[#([1-9]\d*)\]\(/,
    /后评论/,
    /^####\s*你好啊，陌生人/i,
    /^####\s*快捷功能区/i,
    /^####\s*所有版块/i,
    /^####\s*📈用户数目/i,
    /^相关网站$/i,
    /^站内导航$/i,
    /^商业推广$/i,
    /^其他平台$/i,
    /^联系我们$/i,
    /^copyright\s*©/i
  ];

  let end = lines.length;
  for (let i = start; i < lines.length; i += 1) {
    const line = String(lines[i] || "").trim();
    if (!line) continue;
    if (endPatterns.some((pattern) => pattern.test(line))) {
      end = i;
      break;
    }
  }

  let sliced = lines.slice(start, end).join("\n").trim();
  if (!sliced) sliced = raw;

  if (title) {
    const titleHeading = `# ${title}`;
    if (!sliced.startsWith(titleHeading)) {
      sliced = `${titleHeading}\n\n${sliced}`;
    }
  }

  return sliced.trim();
}

async function fetchMirrorImportPage(targetUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const mirrorUrl = `https://r.jina.ai/http://${targetUrl.host}${targetUrl.pathname}${targetUrl.search}${targetUrl.hash || ""}`;
    const response = await fetch(mirrorUrl, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    if (!response.ok) throw new Error("镜像抓取失败：" + response.status);

    const text = await response.text();
    const titleMatch = text.match(/^Title:\s*(.+)$/m);
    const sourceMatch = text.match(/^URL Source:\s*(.+)$/m);
    const marker = "Markdown Content:";
    const idx = text.indexOf(marker);
    const markdown = (idx >= 0 ? text.slice(idx + marker.length) : text).trim();
    if (!markdown) throw new Error("镜像未返回正文内容");

    const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : targetUrl.hostname;
    const sourceUrl = sourceMatch && sourceMatch[1] ? sourceMatch[1].trim() : targetUrl.toString();
    const primaryMarkdown = extractPrimaryMarkdownFromMirror(markdown, title);
    const html = sanitizeImportedHtml(md.render(primaryMarkdown), sourceUrl);
    const intro = plainTextFromHtml(html).slice(0, 220);

    return {
      finalUrl: new URL(sourceUrl),
      documentTitle: title,
      metaDescription: "",
      readabilityTitle: title,
      readabilityExcerpt: intro,
      readabilityHtml: html,
      mainHtml: html,
      mirrorMarkdown: trimToLength(primaryMarkdown, MAX_AI_TEXT_CHARS * 2, "\n…"),
      textExcerpt: trimToLength(plainTextFromHtml(html), MAX_AI_TEXT_CHARS, " …"),
      title,
      intro,
      sourceUrl,
      content: html
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchImportPayloadViaMirror(targetUrl) {
  const page = await fetchMirrorImportPage(targetUrl);
  return {
    title: page.title,
    intro: page.intro,
    sourceUrl: page.sourceUrl,
    contentType: "rich",
    content: page.content
  };
}

async function importFromUrl(rawUrl, settings) {
  const aiConfig = getAiImportConfig(settings);
  const input = String(rawUrl || "").trim();
  if (!input) throw new Error("请输入链接");

  let target;
  try {
    target = new URL(input);
  } catch (_) {
    throw new Error("链接格式不正确");
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("仅支持 http/https 协议");
  }
  if (isBlockedHostname(target.hostname)) {
    throw new Error("不允许抓取内网地址");
  }

  let aiError = null;

  if (aiConfig.apiKey) {
    const candidates = [target];
    if (target.protocol === "https:") {
      const fallback = new URL(target.toString());
      fallback.protocol = "http:";
      candidates.push(fallback);
    }

    for (const candidate of candidates) {
      try {
        const { finalUrl, html } = await fetchHtmlForImport(candidate);
        const page = buildImportCandidates(html, finalUrl);
        const result = await extractImportPayloadWithAi(page, aiConfig);
        return { ...result, importMethod: "ai" };
      } catch (error) {
        aiError = error;
      }
    }
  }

  let firstError = null;
  try {
    const result = await fetchImportPayload(target);
    return aiError
      ? { ...result, importMethod: "fallback", warning: `AI 抓取失败，已回退为基础抓取：${aiError.message}` }
      : { ...result, importMethod: "classic" };
  } catch (error) {
    firstError = error;
  }

  if (target.protocol === "https:") {
    const fallback = new URL(target.toString());
    fallback.protocol = "http:";
    try {
      const result = await fetchImportPayload(fallback);
      return aiError
        ? { ...result, importMethod: "fallback", warning: `AI 抓取失败，已回退为基础抓取：${aiError.message}` }
        : { ...result, importMethod: "classic" };
    } catch (_) {}
  }

  let mirrorError = null;
  try {
    const mirrorPage = await fetchMirrorImportPage(target);

    if (aiConfig.apiKey) {
      try {
        const aiResult = await extractImportPayloadWithAi(mirrorPage, aiConfig);
        return aiError
          ? { ...aiResult, importMethod: "ai-mirror", warning: `源站直抓失败，已改用镜像 + AI 净化：${aiError.message}` }
          : { ...aiResult, importMethod: "ai-mirror" };
      } catch (error) {
        mirrorError = error;
      }
    }

    const result = {
      title: mirrorPage.title,
      intro: mirrorPage.intro,
      sourceUrl: mirrorPage.sourceUrl,
      contentType: "rich",
      content: mirrorPage.content
    };
    const reason = mirrorError?.message || aiError?.message || "AI 不可用";
    return { ...result, importMethod: "mirror", warning: `AI 抓取失败，已回退为镜像净化抓取：${reason}` };
  } catch (error) {
    mirrorError = error;
  }

  const msg = String((mirrorError && mirrorError.message) || (aiError && aiError.message) || (firstError && firstError.message) || "");
  if (msg.includes("fetch failed") || msg.includes("aborted")) {
    throw new Error("抓取目标超时或网络不可达，请稍后重试");
  }
  throw new Error(msg || "导入失败");
}

function isAdminAuthEnabled() {
  return Boolean(ADMIN_USERNAME && ADMIN_PASSWORD);
}

function parseCookies(req) {
  const cookieHeader = String(req.headers.cookie || "");
  const cookies = {};
  for (const part of cookieHeader.split(/;\s*/)) {
    if (!part) continue;
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = decodeURIComponent(part.slice(0, eqIndex).trim());
    const value = decodeURIComponent(part.slice(eqIndex + 1).trim());
    cookies[key] = value;
  }
  return cookies;
}

function createAdminSessionToken() {
  return Buffer.from(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}:${ADMIN_SESSION_SECRET}`, "utf8").toString("base64url");
}

function setAdminSessionCookie(res) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(createAdminSessionToken())}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  res.append("Set-Cookie", parts.join("; "));
}

function clearAdminSessionCookie(res) {
  res.append("Set-Cookie", `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function isLoggedIn(req) {
  if (!isAdminAuthEnabled()) return true;
  const cookies = parseCookies(req);
  return cookies[ADMIN_SESSION_COOKIE] === createAdminSessionToken();
}

function requireAdminAuth(req, res, next) {
  if (isLoggedIn(req)) return next();

  const wantsJson = String(req.headers.accept || "").includes("application/json") || req.path.startsWith("/api/");
  if (wantsJson) {
    return res.status(401).json({ error: "请先登录后台" });
  }

  const nextPath = encodeURIComponent(req.originalUrl || "/admin");
  return res.redirect(`/login?next=${nextPath}`);
}

ensureFoldersAndDb();

app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/bootstrap", (req, res) => {
  const db = readDb();
  const categories = [...db.categories].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const articles = sortByCreatedAtDesc(db.articles).map((a) => withCategoryName(a, categories));
  res.json({ settings: getPublicSettings(db.settings), categories, articles });
});

app.get("/login", (req, res) => {
  if (isLoggedIn(req)) {
    const nextPath = String(req.query.next || "/admin");
    return res.redirect(nextPath);
  }
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/login", (req, res) => {
  if (!isAdminAuthEnabled()) return res.json({ success: true, next: String(req.body?.next || "/admin") });

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const nextPath = String(req.body?.next || "/admin").trim() || "/admin";

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "账号或密码不正确" });
  }

  setAdminSessionCookie(res);
  res.json({ success: true, next: nextPath.startsWith("/") ? nextPath : "/admin" });
});

app.post("/api/logout", (req, res) => {
  clearAdminSessionCookie(res);
  res.json({ success: true });
});

app.get("/api/settings", requireAdminAuth, (req, res) => {
  const db = readDb();
  const ai = getAiImportConfig(db.settings);
  res.json({
    ...getPublicSettings(db.settings),
    aiBaseUrl: ai.baseUrl,
    aiApiKey: ai.apiKey,
    aiModel: ai.model
  });
});

app.put("/api/settings", requireAdminAuth, (req, res) => {
  const db = readDb();
  const next = normalizeSettings(req.body, { includePrivate: true });
  db.settings = next;
  writeDb(db);
  const ai = getAiImportConfig(next);
  res.json({
    ...getPublicSettings(next),
    aiBaseUrl: ai.baseUrl,
    aiApiKey: ai.apiKey,
    aiModel: ai.model
  });
});

app.post("/api/import-url", requireAdminAuth, async (req, res) => {
  try {
    const db = readDb();
    const result = await importFromUrl(req.body?.url, db.settings);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || "导入失败" });
  }
});

app.get("/api/categories", requireAdminAuth, (req, res) => {
  const db = readDb();
  const categories = [...db.categories].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json(categories);
});

app.post("/api/categories", requireAdminAuth, (req, res) => {
  const db = readDb();
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "分类名称不能为空" });
  const exists = db.categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  if (exists) return res.status(409).json({ error: "分类已存在" });
  const category = { id: createId("cat"), name, createdAt: new Date().toISOString() };
  db.categories.push(category);
  writeDb(db);
  res.status(201).json(category);
});

app.delete("/api/categories/:id", requireAdminAuth, (req, res) => {
  const db = readDb();
  const categoryId = String(req.params.id || "").trim();
  const exists = db.categories.some((c) => c.id === categoryId);
  if (!exists) return res.status(404).json({ error: "分类不存在" });
  const usedCount = db.articles.filter((a) => a.categoryId === categoryId).length;
  if (usedCount > 0) {
    return res.status(409).json({ error: `该分类下还有 ${usedCount} 篇文章，无法删除` });
  }
  db.categories = db.categories.filter((c) => c.id !== categoryId);
  writeDb(db);
  res.json({ success: true });
});

app.get("/api/articles", (req, res) => {
  const db = readDb();
  const categoryId = String(req.query.categoryId || "").trim();
  const source = categoryId ? db.articles.filter((a) => a.categoryId === categoryId) : db.articles;
  const items = sortByCreatedAtDesc(source).map((a) => withCategoryName(a, db.categories));
  res.json(items);
});

app.get("/api/articles/:id", (req, res) => {
  const db = readDb();
  const id = String(req.params.id || "").trim();
  const article = db.articles.find((a) => a.id === id);
  if (!article) return res.status(404).json({ error: "文章不存在" });
  res.json(withCategoryName(article, db.categories));
});

app.post("/api/articles", requireAdminAuth, (req, res) => {
  const db = readDb();
  const title = String(req.body?.title || "").trim();
  const intro = String(req.body?.intro || "").trim();
  const sourceUrl = String(req.body?.sourceUrl || "").trim();
  const categoryId = String(req.body?.categoryId || "").trim();
  const contentType = normalizeContentType(req.body?.contentType);
  const content = String(req.body?.content || "");

  if (!title) return res.status(400).json({ error: "文章标题不能为空" });
  if (!categoryId) return res.status(400).json({ error: "请选择分类" });
  const category = db.categories.find((c) => c.id === categoryId);
  if (!category) return res.status(400).json({ error: "分类不存在" });

  const now = new Date().toISOString();
  const article = {
    id: createId("art"),
    title,
    intro,
    sourceUrl,
    categoryId,
    contentType,
    content,
    createdAt: now,
    updatedAt: now
  };
  db.articles.push(article);
  writeDb(db);
  res.status(201).json(withCategoryName(article, db.categories));
});

app.put("/api/articles/:id", requireAdminAuth, (req, res) => {
  const db = readDb();
  const id = String(req.params.id || "").trim();
  const idx = db.articles.findIndex((a) => a.id === id);
  if (idx < 0) return res.status(404).json({ error: "文章不存在" });

  const title = String(req.body?.title || "").trim();
  const intro = String(req.body?.intro || "").trim();
  const sourceUrl = String(req.body?.sourceUrl || "").trim();
  const categoryId = String(req.body?.categoryId || "").trim();
  const contentType = normalizeContentType(req.body?.contentType);
  const content = String(req.body?.content || "");

  if (!title) return res.status(400).json({ error: "文章标题不能为空" });
  if (!categoryId) return res.status(400).json({ error: "请选择分类" });
  const category = db.categories.find((c) => c.id === categoryId);
  if (!category) return res.status(400).json({ error: "分类不存在" });

  const updated = {
    ...db.articles[idx],
    title,
    intro,
    sourceUrl,
    categoryId,
    contentType,
    content,
    updatedAt: new Date().toISOString()
  };
  db.articles[idx] = updated;
  writeDb(db);
  res.json(withCategoryName(updated, db.categories));
});

app.post("/api/uploads/image", requireAdminAuth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "未检测到图片" });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

app.get("/admin", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/admin/article/:id/edit", requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-article-edit.html"));
});

app.get("/logout", (req, res) => {
  clearAdminSessionCookie(res);
  res.redirect("/login");
});

app.get("/article/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "article.html"));
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: "图片上传失败，请检查大小是否超过 10MB" });
  }
  if (error) return res.status(400).json({ error: error.message || "请求处理失败" });
  next();
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
