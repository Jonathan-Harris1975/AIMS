import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import fetch from "node-fetch";
import { info, warn } from "../../../logger.js";
import { countWords } from "./wordBudget.js";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export function htmlToArticleText(html = "") {
  let body = String(html).replace(/<(script|style|nav|header|footer|aside|form|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  body = body.replace(/<([a-z]+)\b[^>]*(?:class|id)=["'][^"']*\b(?:advert|advertisement|cookie|social-share|related-posts)\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, " ");
  const article = body.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) || body.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (article) body = article[1];
  else {
    const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => match[1]);
    if (paragraphs.length) body = paragraphs.join("\n\n");
  }
  return body.replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|mdash|ndash);/gi, (_, entity) => ({
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘",
      rdquo: "”", ldquo: "“", mdash: "—", ndash: "–",
    })[entity.toLowerCase()]).replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();
}

export function isPublicAddress(address) {
  const value = String(address).replace(/^\[|\]$/g, "");
  if (isIP(value) === 6) return /^[23][0-9a-f]{3}:/i.test(value) && !/^2001:(?:db8|0):/i.test(value);
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
}

export async function retrieveArticle(url, { fetchImpl = fetch, lookupImpl = lookup } = {}) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const host = current.hostname.replace(/^\[|\]$/g, "");
    if (!["https:", "http:"].includes(current.protocol) || current.username || current.password
      || (current.port && !["80", "443"].includes(current.port))
      || /(^localhost$|\.(?:localhost|local|internal|home\.arpa)$)/i.test(host)) throw new Error("article_url_blocked");
    // Pin the validated DNS answer to the connection to prevent DNS rebinding.
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
      : await Promise.race([lookupImpl(host, { all: true }), new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("article_timeout")), { once: true });
      })]);
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) throw new Error("article_private_address");
    const pinnedLookup = (_host, options, callback) => options?.all
      ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
    const Agent = current.protocol === "https:" ? https.Agent : http.Agent;
    const agent = new Agent({ lookup: pinnedLookup });
    let next;
    try {
      const response = await fetchImpl(current, {
        redirect: "manual", signal, agent, size: MAX_BYTES,
        headers: { accept: "text/html,application/xhtml+xml,text/plain", "user-agent": "AIMS podcast source retrieval" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        next = response.headers.get("location");
        response.body?.destroy?.();
        if (!next) throw new Error("article_redirect_without_location");
      } else {
        if (!response.ok) throw new Error(`article_http_${response.status}`);
        if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("article_size_limit");
        const type = response.headers.get("content-type") || "";
        if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(type)) throw new Error("article_content_type");
        const buffers = [];
        let bytes = 0;
        for await (const part of response.body) {
          bytes += Buffer.byteLength(part);
          if (bytes > MAX_BYTES) { response.body?.destroy?.(); throw new Error("article_size_limit"); }
          buffers.push(Buffer.from(part));
        }
        const html = Buffer.concat(buffers).toString("utf8");
        // RSS short links are static HTML redirects, not HTTP redirects.
        const refresh = [...html.matchAll(/<meta\b[^>]*>/gi)].find((match) => /http-equiv=["']refresh["']/i.test(match[0]));
        const refreshContent = refresh?.[0].match(/content=["']([^"']+)["']/i)?.[1];
        next = refreshContent?.match(/\burl\s*=\s*(.+)$/i)?.[1]?.replace(/&amp;/g, "&");
        if (!next) return { text: htmlToArticleText(html), canonicalUrl: current.toString() };
      }
    } finally { agent.destroy(); }
    if (hop === MAX_REDIRECTS) throw new Error("article_redirect_limit");
    current = new URL(next, current);
  }
  throw new Error("article_redirect_limit");
}

function normalised(value) { return String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function similarity(a, b) {
  const first = new Set(normalised(a).split(" ").filter((word) => word.length > 3 || /^\d+$/.test(word)));
  const second = new Set(normalised(b).split(" ").filter((word) => word.length > 3 || /^\d+$/.test(word)));
  if (!first.size || !second.size) return 0;
  const shared = [...first].filter((word) => second.has(word)).length;
  return shared / (first.size + second.size - shared);
}

export function deduplicateArticles(articles) {
  const kept = [];
  const duplicates = [];
  for (const article of [...articles].sort((a, b) => countWords(b.summary) - countWords(a.summary))) {
    const duplicate = kept.find((other) => (article.link && article.link === other.link)
      || normalised(article.title) === normalised(other.title)
      || (countWords(article.summary) > 20 && normalised(article.summary) === normalised(other.summary))
      || (similarity(article.title, other.title) >= 0.75 && similarity(article.summary, other.summary) >= 0.65));
    if (duplicate) duplicates.push({ title: article.title, consolidatedInto: duplicate.title });
    else kept.push(article);
  }
  return { articles: kept, duplicates };
}

export async function prepareArticleSources(items, { expand = retrieveArticle, sessionId } = {}) {
  const initial = items.map((item) => {
    const fields = [item["content:encoded"], item.content, item.summary, item.contentSnippet, item.description]
      .map((text) => htmlToArticleText(text || "")).sort((a, b) => countWords(b) - countWords(a));
    return { title: String(item.title || "").trim(), summary: fields[0] || "", link: item.link || item.url || "",
      publicationDate: item.isoDate || item.pubDate || item.published || null, score: item.score || 0, expanded: false };
  }).filter((article) => article.title && article.summary);
  const before = deduplicateArticles(initial);
  let expandedArticles = 0;
  const unavailableArticles = [];
  for (const article of before.articles) {
    if (countWords(article.summary) >= 300 || !article.link) continue;
    try {
      const expanded = await expand(article.link);
      if (countWords(expanded.text) > countWords(article.summary)) {
        article.summary = expanded.text;
        article.link = expanded.canonicalUrl;
        article.expanded = true;
        expandedArticles += 1;
      } else throw new Error("article_no_additional_text");
    } catch (err) {
      // Paths/queries and exception messages may contain credentials. Keep
      // operational identifiers to the title and safe hostname only.
      let host = null;
      try { host = new URL(article.link).hostname; } catch { /* invalid source link */ }
      const reason = /^article_[a-z0-9_]+$/.test(err.message) ? err.message : "article_unavailable";
      const unavailable = { title: article.title, host, reason };
      unavailableArticles.push(unavailable);
      warn("podcast.source.expansion_unavailable", { sessionId, ...unavailable });
    }
  }
  const final = deduplicateArticles(before.articles);
  const stats = { eligibleItems: items.length, selectedItems: final.articles.length, expandedArticles, unavailableArticles,
    duplicates: [...before.duplicates, ...final.duplicates],
    sourceWords: final.articles.reduce((sum, article) => sum + countWords(article.summary), 0),
    sourceCharacters: final.articles.reduce((sum, article) => sum + article.summary.length, 0) };
  info("podcast.source.coverage", { sessionId, ...stats });
  return { articles: final.articles.sort((a, b) => b.score - a.score), stats };
}
