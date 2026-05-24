import Parser from "rss-parser";
import { warn } from "../../../logger.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";

const parser = new Parser();

const DEFAULT_PUBLIC_RSS_URL = "https://ai-news.jonathan-harris.online/feed.xml";
const DEFAULT_RSS_BUCKET_ALIAS = "rss";
const DEFAULT_RSS_JSON_KEY = "feed.json";
const DEFAULT_RSS_XML_KEY = "feed.xml";

function cleanText(value = "", max = 2500) {
  const text = String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function decodeMaybeCdata(value = "") {
  if (value && typeof value === "object") {
    return value.__cdata || value["#text"] || value.text || value.content || "";
  }
  return value;
}

function parsePubDate(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normaliseFeedItems(itemsRaw = []) {
  const items = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw].filter(Boolean);

  return items
    .map((item) => ({
      title: cleanText(item?.title || item?.shortTitle || item?.name || "", 300),
      summary: cleanText(
        decodeMaybeCdata(item?.description) ||
          decodeMaybeCdata(item?.summary) ||
          item?.contentSnippet ||
          decodeMaybeCdata(item?.content) ||
          item?.rewritten ||
          "",
        2500
      ),
      link: String(item?.link || item?.guid || item?.url || "").trim(),
      source: cleanText(item?.source || item?.creator || item?.author || "Jonathan Harris RSS Feed", 150),
      pubDate: parsePubDate(item?.pubDate || item?.isoDate || item?.date || item?.published || item?.createdAt),
    }))
    .filter((item) => item.title && (item.summary || item.link));
}

function sortByFreshness(items = []) {
  return [...items].sort((a, b) => {
    const right = Date.parse(b.pubDate || "") || 0;
    const left = Date.parse(a.pubDate || "") || 0;
    return right - left;
  });
}

function pickArticle(items = []) {
  const sorted = sortByFreshness(items);
  if (!sorted.length) return null;

  const mode = String(process.env.BLOTATO_RSS_PICK_MODE || "latest").trim().toLowerCase();
  if (mode === "random") {
    return sorted[Math.floor(Math.random() * sorted.length)];
  }

  return sorted[0];
}

function rssFeedUrlFromEnv() {
  const direct =
    process.env.BLOTATO_NEWS_RSS_URL ||
    process.env.BLOTATO_RSS_FEED_URL ||
    process.env.RSS_FEED_URL ||
    "";

  if (String(direct || "").trim()) return String(direct).trim();

  const base = String(process.env.R2_PUBLIC_BASE_URL_RSS || "").trim().replace(/\/+$/, "");
  if (base) {
    const key = String(process.env.RSS_OBJECT_KEY || DEFAULT_RSS_XML_KEY).trim().replace(/^\/+/, "") || DEFAULT_RSS_XML_KEY;
    return `${base}/${key}`;
  }

  return DEFAULT_PUBLIC_RSS_URL;
}

async function loadFromR2Json() {
  const bucketAlias = String(process.env.BLOTATO_RSS_BUCKET_ALIAS || DEFAULT_RSS_BUCKET_ALIAS).trim() || DEFAULT_RSS_BUCKET_ALIAS;
  const key = String(process.env.BLOTATO_RSS_JSON_KEY || DEFAULT_RSS_JSON_KEY).trim().replace(/^\/+/, "") || DEFAULT_RSS_JSON_KEY;
  const raw = await getObjectAsText(bucketAlias, key);
  const parsed = JSON.parse(raw);
  const items = parsed?.rss?.channel?.item || parsed?.channel?.item || parsed?.items || [];
  return {
    sourceType: "r2-json",
    source: `${bucketAlias}/${key}`,
    items: normaliseFeedItems(items),
  };
}

async function loadFromRssUrl() {
  const url = rssFeedUrlFromEnv();
  const feed = await parser.parseURL(url);
  return {
    sourceType: "rss-url",
    source: url,
    items: normaliseFeedItems(feed?.items || []),
  };
}

export async function pickArticleFromRssFeed() {
  const preferR2 = String(process.env.BLOTATO_RSS_PREFER_R2 || "true").trim().toLowerCase() !== "false";
  const attempts = preferR2 ? [loadFromR2Json, loadFromRssUrl] : [loadFromRssUrl, loadFromR2Json];
  const warnings = [];

  for (const load of attempts) {
    try {
      const result = await load();
      const article = pickArticle(result.items);
      if (article) {
        return {
          ...result,
          article,
          totalItems: result.items.length,
          warnings,
        };
      }
      warnings.push(`${result.sourceType} returned no usable RSS items`);
    } catch (error) {
      warnings.push(error?.message || String(error));
    }
  }

  warn("blotato.rss.articlePicker.empty", { warnings });

  const err = new Error("No usable article found in the configured RSS feed");
  err.statusCode = 502;
  err.details = { warnings };
  throw err;
}
