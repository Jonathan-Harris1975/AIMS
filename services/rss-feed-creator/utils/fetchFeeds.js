// ============================================================
// 📰 Fetch Feeds Utility (PARSES items)
// ============================================================
// Rotates through rss-feeds.txt and url-feeds.txt (with legacy
// local fallbacks to feeds.txt / urls.txt), then fetches and parses
// each selected feed into article items.
// ============================================================

import Parser from "rss-parser";
import pLimit from "p-limit";
import { info, warn, debug } from "../../../logger.js";
import { fetchWithTimeout } from "../../shared/http-client.js";
import { loadRotationState, saveFeedRotation } from "./feedRotationManager.js";
import { readLocalOrR2File } from "./fileReader.js";

const parser = new Parser();

function positiveIntEnv(name, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

const FEED_FETCH_TIMEOUT_MS = Number(process.env.FEED_FETCH_TIMEOUT_MS) || 15_000;
const FEED_ACCEPT_HEADER = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, application/json;q=0.8, */*;q=0.5";

// Tunables
const MAX_RSS_FEEDS_PER_RUN = Number(process.env.MAX_RSS_FEEDS_PER_RUN) || 5;
const MAX_URL_FEEDS_PER_RUN = Number(process.env.MAX_URL_FEEDS_PER_RUN) || 1;
const MAX_ITEMS_PER_FEED = Number(process.env.MAX_ITEMS_PER_FEED) || 20; // safety cap
const FEED_CUTOFF_HOURS = Number(process.env.FEED_CUTOFF_HOURS) || 48; // default 48 hours
const FEED_FETCH_CONCURRENCY = positiveIntEnv("FEED_FETCH_CONCURRENCY", 2, 4);
const RSS_EMPTY_BATCH_ADVANCE_ATTEMPTS = positiveIntEnv("RSS_EMPTY_BATCH_ADVANCE_ATTEMPTS", 3, 20);

function normaliseIndex(index, length) {
  if (!length) return 0;
  const parsed = Number(index);
  if (!Number.isFinite(parsed)) return 0;
  return ((Math.floor(parsed) % length) + length) % length;
}

function selectRotatingBatch(list, startIndex, requestedCount) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const count = Math.min(Math.max(1, requestedCount), list.length);
  const start = normaliseIndex(startIndex, list.length);
  const batch = [];
  for (let i = 0; i < count; i += 1) {
    batch.push(list[(start + i) % list.length]);
  }
  return batch;
}

function advanceIndex(index, count, length) {
  if (!length) return 0;
  return normaliseIndex(index + Math.min(Math.max(1, count), length), length);
}

function dedupeArticles(items = []) {
  const seen = new Set();
  const deduped = [];
  for (const it of items) {
    const key = it.link || `title:${it.title}`;
    if (key && !seen.has(key)) {
      seen.add(key);
      deduped.push(it);
    }
  }
  return deduped;
}

async function parseSelectedFeeds(selected) {
  const feedFetchLimit = pLimit(FEED_FETCH_CONCURRENCY);
  const parsedLists = await Promise.all(selected.map((url) => feedFetchLimit(() => fetchAndParseOne(url))));
  return parsedLists.flat();
}

function escapeInvalidXmlEntities(xml = "") {
  return String(xml).replace(/&(?!#\d+;|#x[0-9a-fA-F]+;|amp;|lt;|gt;|quot;|apos;)/g, "&amp;");
}

async function parseFeedPayload(raw, url) {
  const text = String(raw || "");
  try {
    return await parser.parseString(text);
  } catch (firstErr) {
    const escaped = escapeInvalidXmlEntities(text);
    if (escaped !== text) {
      try {
        const feed = await parser.parseString(escaped);
        warn("rss.fetchFeeds.parse.recovered", {
          url,
          err: firstErr.message,
          recovery: "escaped-invalid-xml-entities",
        });
        return feed;
      } catch (secondErr) {
        secondErr.firstParseError = firstErr;
        throw secondErr;
      }
    }
    throw firstErr;
  }
}

async function loadFeedFromUrl(url) {
  const response = await fetchWithTimeout(url, {
    timeout: FEED_FETCH_TIMEOUT_MS,
    headers: { accept: FEED_ACCEPT_HEADER },
  });

  if (!response.ok) {
    throw new Error(`Feed fetch failed: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return parseFeedPayload(text, url);
}

function parseList(raw = "") {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function isWithinCutoff(pubDate) {
  try {
    const itemDate = new Date(pubDate);
    if (isNaN(itemDate.getTime())) return false;

    const now = new Date();
    const cutoffMs = FEED_CUTOFF_HOURS * 60 * 60 * 1000;
    const ageMs = now - itemDate;

    return ageMs <= cutoffMs && ageMs >= 0; // Also reject future dates
  } catch {
    return false;
  }
}

function toArticle(item) {
  // Map typical RSS fields → our internal article shape
  const title = item.title?.toString().trim() || "";
  const link = (item.link || item.guid || "").toString().trim();
  const summary =
    (item.contentSnippet || item.content || item.summary || item.description || "")
      .toString()
      .trim();

  let pubDate = item.isoDate || item.pubDate || item.date || "";
  try {
    const d = new Date(pubDate);
    if (!isNaN(d.getTime())) {
      pubDate = d.toISOString();
    } else {
      pubDate = new Date().toISOString();
    }
  } catch {
    pubDate = new Date().toISOString();
  }

  return { title, summary, link, pubDate };
}

async function fetchAndParseOne(url) {
  try {
    const feed = await loadFeedFromUrl(url);
    const items = Array.isArray(feed.items) ? feed.items : [];
    const mapped = items.slice(0, MAX_ITEMS_PER_FEED).map(toArticle);

    // Filter out entries missing both title and summary
    const cleaned = mapped.filter((i) => i.title || i.summary);

    // Apply time window filter
    const withinCutoff = cleaned.filter((i) => isWithinCutoff(i.pubDate));

    const filtered = withinCutoff.length;
    const discarded = cleaned.length - filtered;

    debug("rss.fetchFeeds.parsed", {
      url,
      count: filtered,
      sourceItems: items.length,
      discardedOld: discarded,
      cutoffHours: FEED_CUTOFF_HOURS,
    });

    return withinCutoff;
  } catch (err) {
    warn("rss.fetchFeeds.parse.skipped", { url, err: err.message });
    return [];
  }
}

export async function fetchAndParseFeeds() {
  // 1) Load feed URL lists (from local or R2)
  const rssFeedsText = await readLocalOrR2File("rss-feeds.txt");
  const urlFeedsText = await readLocalOrR2File("url-feeds.txt");

  const rssFeedsAll = parseList(rssFeedsText);
  const urlFeedsAll = parseList(urlFeedsText);

  if (rssFeedsAll.length === 0 && urlFeedsAll.length === 0) {
    throw new Error("No feeds available in rss-feeds.txt or url-feeds.txt");
  }

  const rssBatchSize = Math.min(MAX_RSS_FEEDS_PER_RUN, Math.max(1, rssFeedsAll.length));
  const urlBatchSize = Math.min(MAX_URL_FEEDS_PER_RUN, Math.max(1, urlFeedsAll.length));
  const maxPossibleAttempts = Math.max(
    rssFeedsAll.length ? Math.ceil(rssFeedsAll.length / rssBatchSize) : 0,
    urlFeedsAll.length ? Math.ceil(urlFeedsAll.length / urlBatchSize) : 0,
    1
  );
  const attemptsToRun = Math.min(RSS_EMPTY_BATCH_ADVANCE_ATTEMPTS, maxPossibleAttempts);

  // 2) Rotation state → pick the next batch. If a batch has no fresh items,
  // move on within the same run rather than stopping the rewrite pipeline empty.
  const initialRotation = await loadRotationState();
  let currentRssIndex = normaliseIndex(initialRotation.rssIndex ?? 0, rssFeedsAll.length);
  let currentUrlIndex = normaliseIndex(initialRotation.urlIndex ?? 0, urlFeedsAll.length);
  let latestNextRssIndex = currentRssIndex;
  let latestNextUrlIndex = currentUrlIndex;
  let lastParsedTotal = 0;

  for (let attempt = 1; attempt <= attemptsToRun; attempt += 1) {
    const rssBatch = selectRotatingBatch(rssFeedsAll, currentRssIndex, MAX_RSS_FEEDS_PER_RUN);
    const urlBatch = selectRotatingBatch(urlFeedsAll, currentUrlIndex, MAX_URL_FEEDS_PER_RUN);
    const selected = [...rssBatch, ...urlBatch];

    latestNextRssIndex = advanceIndex(currentRssIndex, MAX_RSS_FEEDS_PER_RUN, rssFeedsAll.length);
    latestNextUrlIndex = advanceIndex(currentUrlIndex, MAX_URL_FEEDS_PER_RUN, urlFeedsAll.length);

    await saveFeedRotation({ rssIndex: latestNextRssIndex, urlIndex: latestNextUrlIndex });

    debug("rss.fetchFeeds.rotation.enabled", {
      attempt,
      attemptsToRun,
      rssIndex: currentRssIndex,
      urlIndex: currentUrlIndex,
      rssFeeds: rssBatch.length,
      urlFeeds: urlBatch.length,
      selected: selected.length,
      cutoffHours: FEED_CUTOFF_HOURS,
      fetchConcurrency: FEED_FETCH_CONCURRENCY,
    });

    const items = await parseSelectedFeeds(selected);
    lastParsedTotal += items.length;
    const deduped = dedupeArticles(items);

    debug("rss.fetchFeeds.items.ready", {
      attempt,
      parsedTotal: items.length,
      deduped: deduped.length,
      cutoffHours: FEED_CUTOFF_HOURS,
    });

    if (deduped.length > 0) {
      if (attempt > 1) {
        info("rss.fetchFeeds.emptyBatch.recovered", {
          attempt,
          rssIndex: currentRssIndex,
          urlIndex: currentUrlIndex,
          deduped: deduped.length,
        });
      }
      return deduped;
    }

    if (attempt < attemptsToRun) {
      info("rss.fetchFeeds.emptyBatch.advance", {
        attempt,
        attemptsToRun,
        nextRssIndex: latestNextRssIndex,
        nextUrlIndex: latestNextUrlIndex,
        reason: "no fresh feed items in selected batch",
      });
      currentRssIndex = latestNextRssIndex;
      currentUrlIndex = latestNextUrlIndex;
    }
  }

  warn("rss.fetchFeeds.emptyBatch.exhausted", {
    attemptsToRun,
    parsedTotal: lastParsedTotal,
    cutoffHours: FEED_CUTOFF_HOURS,
    nextRssIndex: latestNextRssIndex,
    nextUrlIndex: latestNextUrlIndex,
  });

  return [];
}

export default { fetchAndParseFeeds };
