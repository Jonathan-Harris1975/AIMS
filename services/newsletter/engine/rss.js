// services/newsletter/engine/rss.js
//
// Pulls candidate stories for a newsletter profile from its configured RSS
// feeds. Deliberately independent of services/rss-feed-creator (that
// pipeline drives the rewritten-article RSS feed / podcast source content;
// this one is a thin, newsletter-specific reader) so the newsletter engine
// has no runtime dependency on HIVE or on the rewrite pipeline's rotation
// state.

import Parser from "rss-parser";
import fs from "fs";
import path from "path";
import { info, warn, error as logError } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";

const parser = new Parser({
  timeout: THRESHOLDS.newsletter.rssFetchTimeoutMs,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPermanentFeedError(err) {
  const message = String(err?.message || "");
  const statusMatch = message.match(/status code\s+(\d{3})/i);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  if (status && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)) return true;
  return /attribute without value|invalid xml|unexpected close tag|non-whitespace before first tag|feed not recognized/i.test(message);
}

// ------------------------------------------------------------
// Feed list resolution
// ------------------------------------------------------------
export function loadFeedUrls(profile) {
  if (Array.isArray(profile?.feedUrls) && profile.feedUrls.length) {
    return profile.feedUrls;
  }

  const listPath = profile?.feedListPath;
  if (!listPath) return [];

  const resolved = path.isAbsolute(listPath) ? listPath : path.join(process.cwd(), listPath);

  try {
    const raw = fs.readFileSync(resolved, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .filter((line) => {
        try {
          // eslint-disable-next-line no-new
          new URL(line);
          return true;
        } catch {
          warn("newsletter.rss.invalid_feed_url", { line, listPath });
          return false;
        }
      });
  } catch (err) {
    warn("newsletter.rss.feed_list_unreadable", { listPath: resolved, error: err.message });
    return [];
  }
}

// ------------------------------------------------------------
// Single feed fetch with retry/backoff. A malformed or unreachable feed
// must never take down the whole run — it is skipped and logged.
// ------------------------------------------------------------
export async function fetchFeedResilient(feedUrl, {
  retries = THRESHOLDS.newsletter.rssFetchRetries,
  retryBaseMs = THRESHOLDS.newsletter.rssFetchRetryBaseMs,
} = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const feed = await parser.parseURL(feedUrl);
      return { ok: true, feedUrl, items: Array.isArray(feed?.items) ? feed.items : [] };
    } catch (err) {
      lastError = err;
      warn("newsletter.rss.fetch_retry", {
        feedUrl,
        attempt: attempt + 1,
        maxAttempts: retries + 1,
        error: err.message,
      });
      if (isPermanentFeedError(err)) {
        warn("newsletter.rss.fetch_permanent_failure", { feedUrl, attempt: attempt + 1, error: err.message });
        break;
      }
      if (attempt < retries) {
        await sleep(retryBaseMs * 2 ** attempt);
      }
    }
  }

  logError("newsletter.rss.fetch_failed", { feedUrl, error: lastError?.message });
  return { ok: false, feedUrl, items: [], error: lastError?.message || "unknown error" };
}

// ------------------------------------------------------------
// Normalisation + dedupe + window filter
// ------------------------------------------------------------
function normaliseItem(item, feedUrl) {
  const link = String(item?.link || item?.guid || "").trim();
  const title = String(item?.title || "").trim();
  const publishedAt = item?.isoDate || item?.pubDate || null;
  const publishedDate = publishedAt ? new Date(publishedAt) : null;

  return {
    title,
    link,
    sourceFeed: feedUrl,
    summary: String(item?.contentSnippet || item?.summary || item?.content || "").trim(),
    publishedAt: publishedDate && !Number.isNaN(publishedDate.getTime()) ? publishedDate.toISOString() : null,
    creator: item?.creator || item?.author || null,
    categories: Array.isArray(item?.categories) ? item.categories : [],
  };
}

function dedupeKey(item) {
  if (item.link) return item.link.toLowerCase().replace(/[?#].*$/, "");
  return item.title.toLowerCase().replace(/\s+/g, " ").trim();
}

export function withinWindow(item, { now = new Date(), windowHours } = {}) {
  if (!item.publishedAt) return false;
  const published = new Date(item.publishedAt);
  if (Number.isNaN(published.getTime())) return false;
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  return published >= cutoff && published <= now;
}

/**
 * Fetches every configured feed for a profile, normalises items, filters to
 * the configured rolling window and removes duplicates (by canonical link,
 * falling back to normalised title).
 */
export async function collectCandidateStories(profile, { now = new Date() } = {}) {
  const feedUrls = loadFeedUrls(profile);
  const windowHours = THRESHOLDS.newsletter.rssWindowHours;

  if (!feedUrls.length) {
    warn("newsletter.rss.no_feeds_configured", { profileId: profile?.id });
    return { items: [], feedResults: [] };
  }

  const feedResults = await Promise.all(feedUrls.map((url) => fetchFeedResilient(url)));

  const seen = new Map();
  for (const result of feedResults) {
    if (!result.ok) continue;
    for (const raw of result.items) {
      const item = normaliseItem(raw, result.feedUrl);
      if (!item.title || !item.link) continue;
      if (!withinWindow(item, { now, windowHours })) continue;

      const key = dedupeKey(item);
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }
  }

  const items = Array.from(seen.values()).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  info("newsletter.rss.collected", {
    profileId: profile?.id,
    feedsConfigured: feedUrls.length,
    feedsOk: feedResults.filter((r) => r.ok).length,
    feedsFailed: feedResults.filter((r) => !r.ok).length,
    windowHours,
    candidateCount: items.length,
  });

  return { items, feedResults };
}

export default { loadFeedUrls, fetchFeedResilient, withinWindow, collectCandidateStories };
