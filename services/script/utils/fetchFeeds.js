// services/script/utils/fetchFeeds.js
import Parser from "rss-parser";
import { fetchWithTimeout } from "../../shared/http-client.js";
import { getObjectAsText } from "../../shared/utils/r2-client.js";
import { info, error, debug, warn } from "../../../logger.js";

const parser = new Parser();
const FEED_FETCH_TIMEOUT_MS = Number(process.env.FEED_FETCH_TIMEOUT_MS) || 15_000;
const RSS_OBJECT_KEY = process.env.RSS_OBJECT_KEY || "feed.xml";
const RSS_BUCKET_KEY = "rss";
const FEED_ACCEPT_HEADER =
  "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, application/json;q=0.8, */*;q=0.5";

function withinDays(dateValue, days = 7) {
  if (!dateValue) return false;
  const pubDate = new Date(dateValue);
  if (isNaN(pubDate.getTime())) return false;
  const diffDays = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

function calculateArticleScore(item) {
  let score = 0;
  if (item.title) {
    const tl = item.title.length;
    if (tl > 20 && tl < 120) score += 3;
    else if (tl >= 10) score += 1;
  }
  const snippet = item.contentSnippet || item.summary || item.description || "";
  if (snippet.length > 100) score += 2;

  const dateValue = item.pubDate || item.isoDate || item.published;
  if (withinDays(dateValue, 1)) score += 3;
  else if (withinDays(dateValue, 3)) score += 2;
  else if (withinDays(dateValue, 7)) score += 1;

  return score;
}

export async function parseFeedText(text) {
  if (!text || !String(text).trim()) {
    throw new Error("Feed payload was empty");
  }

  const raw = String(text);

  try {
    return await parser.parseString(raw);
  } catch {
    if (raw.includes("<feed")) {
      const matchTitles = [...raw.matchAll(/<title>(.*?)<\/title>/g)].map((m) => m[1]);
      const matchLinks = [...raw.matchAll(/<link[^>]*href="([^"]+)"/g)].map((m) => m[1]);
      return {
        title: matchTitles[0] || "Untitled Feed",
        items: matchTitles.slice(1).map((t, i) => ({
          title: t,
          link: matchLinks[i + 1] || "",
          contentSnippet: "",
        })),
      };
    }

    if (raw.trim().startsWith("{")) {
      const json = JSON.parse(raw);
      return json?.items ? json : { title: "Invalid Feed", items: [] };
    }

    throw new Error("Feed not recognized as RSS, Atom, or JSON");
  }
}

export function filterAndScoreFeedItems(feed, windowDays = 7) {
  const allItems = feed?.items || [];
  const recent = allItems.filter((it) =>
    withinDays(it.pubDate || it.isoDate || it.published, windowDays)
  );

  return recent
    .map((item) => ({ ...item, score: calculateArticleScore(item) }))
    .sort((a, b) => b.score - a.score);
}

async function loadFeedViaHttp(feedUrl) {
  const res = await fetchWithTimeout(feedUrl, {
    timeout: FEED_FETCH_TIMEOUT_MS,
    headers: {
      accept: FEED_ACCEPT_HEADER,
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  const feed = await parseFeedText(text);
  return {
    feed,
    feedUrl,
    source: "http",
  };
}

async function loadFeedViaR2() {
  const text = await getObjectAsText(RSS_BUCKET_KEY, RSS_OBJECT_KEY);
  const feed = await parseFeedText(text);

  return {
    feed,
    feedUrl: `r2://${RSS_BUCKET_KEY}/${RSS_OBJECT_KEY}`,
    source: "r2",
  };
}

function buildFeedLoaders(feedUrl) {
  const loaders = [];

  if (feedUrl) {
    loaders.push({
      label: "http",
      run: () => loadFeedViaHttp(feedUrl),
    });
  }

  loaders.push({
    label: "r2",
    run: () => loadFeedViaR2(),
  });

  return loaders;
}

/**
 * Fetches RSS/Atom/JSON feed and returns all items from the last 7 days,
 * scored and sorted (desc), with no artificial cap.
 * Returns: { items, feedUrl, source }
 */
export default async function fetchFeedArticles(feedUrlArg, windowDays = 7) {
  const feedUrl = feedUrlArg?.trim() || process.env.FEED_URL?.trim();
  const loaders = buildFeedLoaders(feedUrl);

  if (loaders.length === 0) {
    error("❌ No feed source available — configure FEED_URL or RSS storage.");
    return { items: [], feedUrl: null, source: null };
  }

  let lastError = null;

  for (const loader of loaders) {
    try {
      debug("📡 Fetching RSS feed", {
        source: loader.label,
        feedUrl: loader.label === "http" ? feedUrl : `${RSS_BUCKET_KEY}/${RSS_OBJECT_KEY}`,
        timeoutMs: FEED_FETCH_TIMEOUT_MS,
      });

      const loaded = await loader.run();
      const scoredItems = filterAndScoreFeedItems(loaded.feed, windowDays);

      info("📰 Feed articles loaded", {
        source: loaded.source,
        feedUrl: loaded.feedUrl,
        feedTitle: loaded.feed?.title,
        recentItems: scoredItems.length,
        returnedItems: scoredItems.length,
      });

      if (scoredItems.length > 0) {
        return {
          items: scoredItems,
          feedUrl: loaded.feedUrl,
          source: loaded.source,
        };
      }

      warn("Feed source returned no recent items; trying fallback if available", {
        source: loaded.source,
        feedUrl: loaded.feedUrl,
        windowDays,
      });
    } catch (err) {
      lastError = err;
      warn("Feed source failed; trying fallback if available", {
        source: loader.label,
        feedUrl: loader.label === "http" ? feedUrl : `${RSS_BUCKET_KEY}/${RSS_OBJECT_KEY}`,
        error: err.message,
      });
    }
  }

  error("❌ Failed to fetch or parse RSS feed from all configured sources", {
    feedUrl: feedUrl || `${RSS_BUCKET_KEY}/${RSS_OBJECT_KEY}`,
    error: lastError?.message || "No feed items available",
  });

  return {
    items: [],
    feedUrl: feedUrl || `r2://${RSS_BUCKET_KEY}/${RSS_OBJECT_KEY}`,
    source: null,
  };
}
