import Parser from "rss-parser";
import { fetchWithTimeout } from "../../shared/http-client.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { debug, warn } from "../../../logger.js";
import { hasRecentSocialSource } from "../../oneup/utils/state.js";

const parser = new Parser();
const DEFAULT_PUBLIC_RSS_URL = "https://ai-news.jonathan-harris.online/feed.xml";
const DEFAULT_RSS_BUCKET_ALIAS = "rss";
const DEFAULT_RSS_JSON_KEY = "feed.json";
const DEFAULT_RSS_XML_KEY = "feed.xml";
const FEED_ACCEPT_HEADER =
  "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, application/json;q=0.8, */*;q=0.5";

function trim(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const cleaned = String(value).trim();
  return cleaned || fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(normalised)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalised)) return false;
  return fallback;
}

function cleanText(value = "", max = 2500) {
  const text = String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function pubDateMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function unwrapDescription(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value.__cdata || value["#text"] || value.text || value.value || "";
  }
  return String(value);
}

function normaliseItem(item = {}, sourceFallback = "") {
  const title = cleanText(item.title || item.shortTitle || item.name || "", 300);
  const summary = cleanText(
    item.summary ||
      item.contentSnippet ||
      item.description ||
      unwrapDescription(item.description) ||
      item.content ||
      item.rewritten ||
      item.excerpt ||
      "",
    2500
  );
  const link = trim(item.link || item.url || item.guid || "");
  const pubDate = trim(item.pubDate || item.isoDate || item.published || item.published_at || item.date || "");
  const source = cleanText(item.source || item.creator || item.author || sourceFallback || "AI news RSS", 150);

  if (!title && !summary) return null;

  return {
    title: title || cleanText(summary, 90) || "AI news update",
    summary,
    link: /^https?:\/\//i.test(link) ? link : undefined,
    source,
    pubDate: pubDate || undefined,
    _pubDateMs: pubDateMs(pubDate),
  };
}

function normaliseItemsFromJson(json, sourceLabel = "rss-json") {
  const itemsRaw =
    json?.items ||
    json?.feed?.items ||
    json?.rss?.channel?.item ||
    json?.channel?.item ||
    json?.data?.items ||
    [];
  const itemsArray = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw].filter(Boolean);
  const sourceFallback = cleanText(json?.title || json?.rss?.channel?.title || json?.channel?.title || sourceLabel, 150);

  return itemsArray
    .map((item) => normaliseItem(item, sourceFallback))
    .filter(Boolean);
}

async function parseFeedPayload(raw, sourceLabel) {
  const text = String(raw || "").trim();
  if (!text) throw new Error(`${sourceLabel} feed payload was empty`);

  if (text.startsWith("{") || text.startsWith("[")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => normaliseItem(item, sourceLabel)).filter(Boolean);
    }
    return normaliseItemsFromJson(parsed, sourceLabel);
  }

  const parsed = await parser.parseString(text);
  return (parsed.items || [])
    .map((item) => normaliseItem(item, parsed.title || sourceLabel))
    .filter(Boolean);
}

function getHttpFeedUrls() {
  const publicBase = trim(process.env.R2_PUBLIC_BASE_URL_RSS).replace(/\/+$/, "");
  const fromPublicBase = publicBase ? `${publicBase}/${trim(process.env.RSS_OBJECT_KEY, DEFAULT_RSS_XML_KEY)}` : "";

  return [
    process.env.BLOTATO_NEWS_RSS_URL,
    process.env.BLOTATO_RSS_FEED_URL,
    process.env.RSS_FEED_URL,
    process.env.FEED_URL,
    fromPublicBase,
    DEFAULT_PUBLIC_RSS_URL,
  ]
    .map((value) => trim(value))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
}

function getLoaders() {
  const preferR2 = parseBoolean(process.env.BLOTATO_RSS_PREFER_R2, true);
  const bucketAlias = trim(process.env.BLOTATO_RSS_BUCKET_ALIAS, DEFAULT_RSS_BUCKET_ALIAS);
  const jsonKey = trim(process.env.BLOTATO_RSS_JSON_KEY, DEFAULT_RSS_JSON_KEY);
  const xmlKey = trim(process.env.RSS_OBJECT_KEY, DEFAULT_RSS_XML_KEY);

  const r2Loaders = [
    {
      label: `r2://${bucketAlias}/${jsonKey}`,
      run: async () => parseFeedPayload(await getObjectAsText(bucketAlias, jsonKey), `r2:${jsonKey}`),
    },
    {
      label: `r2://${bucketAlias}/${xmlKey}`,
      run: async () => parseFeedPayload(await getObjectAsText(bucketAlias, xmlKey), `r2:${xmlKey}`),
    },
  ];

  const timeout = Number(process.env.FEED_FETCH_TIMEOUT_MS || process.env.BLOTATO_RSS_FETCH_TIMEOUT_MS || 15_000);
  const httpLoaders = getHttpFeedUrls().map((url) => ({
    label: url,
    run: async () => {
      const response = await fetchWithTimeout(url, {
        timeout,
        headers: { accept: FEED_ACCEPT_HEADER },
      });
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }
      return parseFeedPayload(await response.text(), url);
    },
  }));

  return preferR2 ? [...r2Loaders, ...httpLoaders] : [...httpLoaders, ...r2Loaders];
}

function pickItem(items = []) {
  const usable = items
    .filter((item) => item.title && (item.summary || item.link))
    .map((item) => ({ ...item }))
    .sort((a, b) => (b._pubDateMs || 0) - (a._pubDateMs || 0));

  if (!usable.length) return null;

  const unused = usable.filter((item) => !hasRecentSocialSource(item));
  const candidates = unused.length ? unused : usable;
  const mode = trim(process.env.BLOTATO_RSS_PICK_MODE, "latest").toLowerCase();
  if (mode === "random") {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  return candidates[0];
}

export async function selectRssArticleForBlotato() {
  const loaders = getLoaders();
  let lastError = null;

  for (const loader of loaders) {
    try {
      debug("blotato.rss.load.start", { source: loader.label });
      const items = await loader.run();
      const article = pickItem(items);
      if (article) {
        delete article._pubDateMs;
        debug("blotato.rss.load.complete", { source: loader.label, title: article.title });
        return {
          article,
          rssSource: loader.label,
          itemCount: items.length,
        };
      }
      warn("blotato.rss.no_usable_items", { source: loader.label, itemCount: items.length });
    } catch (error) {
      lastError = error;
      warn("blotato.rss.load.fail", { source: loader.label, error: error?.message || String(error) });
    }
  }

  const err = new Error(`No usable RSS article found for Blotato${lastError ? `: ${lastError.message}` : ""}`);
  err.statusCode = 502;
  throw err;
}
