// Fetches and parses the blog service's public "social media blog" RSS
// feed (https://blog-rss.jonathan-harris.online/social-media-blog/feed.xml)
// so a daily post can be built from it and sent to Zernio.
//
// Zernio has no documented "import from RSS" capability of its own, so this
// module does the fetch + parse on the AIMS side; the resulting item is
// then scheduled through the normal Zernio posting path in
// socialScheduler.js. This module is intentionally read-only against the
// blog service: it only ever performs a plain HTTP GET of the public feed
// URL below and never touches the blog service's code, routes, or storage.
import Parser from "rss-parser";
import { fetchWithTimeout } from "../../shared/http-client.js";

const parser = new Parser();
const DEFAULT_FEED_URL = "https://blog-rss.jonathan-harris.online/social-media-blog/feed.xml";
const FEED_ACCEPT_HEADER = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5";

function trim(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const cleaned = String(value).trim();
  return cleaned || fallback;
}

function cleanText(value = "", max = 600) {
  const text = String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

// Converts an RSS <category> value (e.g. "Artificial Intelligence") into a
// social hashtag (e.g. "#ArtificialIntelligence").
function hashtagFromCategory(value = "") {
  const words = String(value || "")
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (!words.length) return "";
  return `#${words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join("")}`;
}

function pubDateMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function normaliseBlogRssItem(item = {}) {
  const title = cleanText(item.title, 300);
  const link = trim(item.link || item.guid);
  if (!title || !link) return null;

  const caption = cleanText(item.contentSnippet || item.summary || item.description, 600) || title;
  const imageUrl = trim(item.enclosure?.url) || trim(item["media:content"]?.$?.url);
  const hashtags = [...new Set((item.categories || []).map(hashtagFromCategory).filter(Boolean))];
  const pubDate = trim(item.isoDate || item.pubDate);

  return {
    title,
    link,
    caption,
    imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : "",
    hashtags,
    pubDate: pubDate || undefined,
    guid: trim(item.guid) || link,
    _pubDateMs: pubDateMs(pubDate),
  };
}

export function getBlogRssFeedUrl() {
  return trim(process.env.ZERNIO_BLOG_RSS_FEED_URL, DEFAULT_FEED_URL);
}

export async function fetchBlogRssItems({ timeoutMs } = {}) {
  const url = getBlogRssFeedUrl();
  const timeout = Number(timeoutMs || process.env.ZERNIO_BLOG_RSS_FETCH_TIMEOUT_MS || 15000);

  const response = await fetchWithTimeout(url, {
    timeout,
    headers: { accept: FEED_ACCEPT_HEADER },
  });

  if (!response.ok) {
    const err = new Error(`Blog social RSS feed request failed: ${response.status} ${response.statusText} (${url})`);
    err.statusCode = 502;
    throw err;
  }

  const xml = await response.text();
  const parsed = await parser.parseString(xml);
  const items = (parsed.items || [])
    .map(normaliseBlogRssItem)
    .filter(Boolean)
    .sort((a, b) => (b._pubDateMs || 0) - (a._pubDateMs || 0))
    .map(({ _pubDateMs, ...item }) => item);

  return { url, feedTitle: trim(parsed.title), items };
}
