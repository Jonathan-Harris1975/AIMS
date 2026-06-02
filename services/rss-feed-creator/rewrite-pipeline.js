// ============================================================
// 🧠 RSS Feed Creator — End-to-End Rewrite Pipeline
// ============================================================
//
// Uses the ACTUAL file names from your repo:
//  - ./utils/fetchFeeds.js
//  - ./utils/models.js
//  - ./utils/feedGenerator.js
//
// Ensures the enriched array (rewrittenItems) is used to build the feed.
// Adds clear preview logging and a one-shot retry on upload.
// ============================================================

import { info, error, debug } from "../../logger.js";
import { fetchAndParseFeeds } from "./utils/fetchFeeds.js";
import { rewriteRssFeedItemsWithQuality } from "./utils/models.js";
import { generateFeed } from "./utils/feedGenerator.js";
import { putJson } from "../shared/utils/r2-client.js";
import { buildPhase3QuarantinePayload, phase3QuarantineKey } from "../content-quality/phase3Gates.js";

function positiveIntEnv(name, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function dedupeRewrittenItems(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = item?.shortUrl || item?.link || item?.shortGuid || item?.shortTitle || item?.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export async function endToEndRewrite() {
  try {
    info("rss-feed-creator.pipeline.start");

    const maxBatchAttempts = positiveIntEnv("RSS_REWRITE_BATCH_ADVANCE_ATTEMPTS", 4, 20);
    const quarantineFallbackThreshold = Math.max(
      0,
      Number.isFinite(Number(process.env.RSS_QUARANTINE_FALLBACK_THRESHOLD))
        ? Number(process.env.RSS_QUARANTINE_FALLBACK_THRESHOLD)
        : 1
    );
    const minPublishableItems = positiveIntEnv("RSS_REWRITE_MIN_PUBLISHABLE_ITEMS", 1, 25);
    const accumulatedSafeItems = [];
    const attemptSummaries = [];
    let lastQualitySummary = null;
    let lastQuarantineKey = null;

    for (let attempt = 1; attempt <= maxBatchAttempts; attempt += 1) {
      info("rss-feed-creator.pipeline.batch_attempt.start", { attempt, maxBatchAttempts });

      // 1) Fetch source items. fetchAndParseFeeds already advances internally when
      // a selected feed rotation batch has no fresh items, so each outer attempt
      // naturally moves to the next available rotation state.
      const feedItems = await fetchAndParseFeeds();
      if (!Array.isArray(feedItems) || feedItems.length === 0) {
        debug("rss-feed-creator.pipeline.noItems", { attempt, reason: "no valid items" });
        attemptSummaries.push({ attempt, totalItems: 0, rewrittenItems: 0, droppedItems: 0, status: "NO_VALID_ITEMS" });
        continue;
      }

      debug("rss-feed-creator.pipeline.fetch.complete", {
        attempt,
        items: feedItems.length,
        sampleTitle: feedItems[0]?.title,
      });

      // 2) Rewrite + enrich. Phase 3 remains fail-closed for individual items:
      // dropped items are quarantined and never reach RSS. If a batch is too
      // noisy, move to the next batch automatically rather than failing the run.
      const { rewrittenItems, droppedItems, qualitySummary } = await rewriteRssFeedItemsWithQuality(feedItems);
      lastQualitySummary = qualitySummary;
      let phase3QuarantineKey = null;

      if (droppedItems.length) {
        phase3QuarantineKey = await safeQuarantinePhase3Drops({
          droppedItems,
          qualitySummary,
          sourceCount: feedItems.length,
          attempt,
        });
        lastQuarantineKey = phase3QuarantineKey;
      }

      accumulatedSafeItems.push(...(Array.isArray(rewrittenItems) ? rewrittenItems : []));
      const safeItems = dedupeRewrittenItems(accumulatedSafeItems);
      const tooManyQuarantined = droppedItems.length > quarantineFallbackThreshold;
      const enoughSafeItems = safeItems.length >= minPublishableItems;

      attemptSummaries.push({
        attempt,
        totalItems: feedItems.length,
        rewrittenItems: rewrittenItems.length,
        droppedItems: droppedItems.length,
        phase3Status: qualitySummary.status,
        phase3QuarantineKey,
        tooManyQuarantined,
      });

      if (!tooManyQuarantined && enoughSafeItems) {
        const result = await publishRewrittenItems({
          feedItemsCount: feedItems.length,
          rewrittenItems: safeItems,
          droppedItems,
          qualitySummary,
          phase3QuarantineKey,
          attempt,
          attemptSummaries,
          fallbackUsed: attempt > 1,
        });
        return result;
      }

      if (attempt < maxBatchAttempts) {
        info("rss-feed-creator.pipeline.batch_attempt.advance", {
          attempt,
          maxBatchAttempts,
          rewrittenItems: rewrittenItems.length,
          droppedItems: droppedItems.length,
          safeItems: safeItems.length,
          reason: tooManyQuarantined
            ? `quarantined items exceeded fallback threshold ${quarantineFallbackThreshold}`
            : "not enough safe rewritten items yet",
        });
        continue;
      }
    }

    const finalSafeItems = dedupeRewrittenItems(accumulatedSafeItems);
    if (finalSafeItems.length >= minPublishableItems) {
      warn("rss-feed-creator.pipeline.fallback_exhausted_publish_safe", {
        attempts: maxBatchAttempts,
        safeItems: finalSafeItems.length,
        minPublishableItems,
        lastQuarantineKey,
      });
      return publishRewrittenItems({
        feedItemsCount: finalSafeItems.length,
        rewrittenItems: finalSafeItems,
        droppedItems: [],
        qualitySummary: {
          ...(lastQualitySummary || {}),
          status: "FALLBACK_EXHAUSTED_PUBLISHED_SAFE_ITEMS",
          rewrittenItems: finalSafeItems.length,
          droppedItems: 0,
        },
        phase3QuarantineKey: lastQuarantineKey,
        attempt: maxBatchAttempts,
        attemptSummaries,
        fallbackUsed: true,
      });
    }

    throw new Error("Phase 3 blocked all RSS rewrite fallback batches; nothing safe to publish");
  } catch (err) {
    error("rss-feed-creator.pipeline.fail", { message: err?.message, stack: err?.stack });
    throw err;
  }
}

async function publishRewrittenItems({
  feedItemsCount = 0,
  rewrittenItems = [],
  droppedItems = [],
  qualitySummary = {},
  phase3QuarantineKey = null,
  attempt = 1,
  attemptSummaries = [],
  fallbackUsed = false,
} = {}) {
  if (!Array.isArray(rewrittenItems) || rewrittenItems.length === 0) {
    throw new Error("Phase 3 blocked all RSS rewrite items; nothing safe to publish");
  }

  const first = rewrittenItems[0] || {};
  debug("rss-feed-creator.pipeline.sample", {
    shortTitle: first.shortTitle,
    shortUrl: first.shortUrl,
    guid: first.shortGuid,
    hasRewritten: !!first.rewritten,
  });

  debug("rss-feed-creator.batch.complete", {
    totalItems: feedItemsCount,
    rewrittenItems: rewrittenItems.length,
    droppedItems: droppedItems.length,
    phase3Status: qualitySummary.status,
    phase3QuarantineKey,
    attempt,
    fallbackUsed,
  });

  await safeGenerateFeed("rss", rewrittenItems);

  debug("rss-feed-creator.pipeline.done", {
    totalItems: feedItemsCount,
    rewrittenItems: rewrittenItems.length,
    droppedItems: droppedItems.length,
    phase3Status: qualitySummary.status,
    attempt,
    fallbackUsed,
  });

  return {
    totalItems: feedItemsCount,
    rewrittenItems: rewrittenItems.length,
    droppedItems: droppedItems.length,
    phase3Quality: qualitySummary,
    phase3QuarantineKey,
    fallbackUsed,
    batchAttempts: attemptSummaries,
  };
}


async function safeQuarantinePhase3Drops({ droppedItems = [], qualitySummary = {}, sourceCount = 0, attempt = 1 } = {}) {
  const key = phase3QuarantineKey({
    contentType: "rss-rewrite",
    id: `attempt-${attempt}-dropped-${droppedItems.length}-of-${sourceCount}`,
  });

  try {
    await putJson("rss", key, buildPhase3QuarantinePayload({
      context: {
        service: "rss-feed-creator",
        pipeline: "endToEndRewrite",
        attempt,
        sourceCount,
        droppedCount: droppedItems.length,
      },
      report: qualitySummary,
      payload: { droppedItems },
    }));
    debug("rss-feed-creator.phase3.quarantine.written", { key, dropped: droppedItems.length });
    return key;
  } catch (err) {
    error("rss-feed-creator.phase3.quarantine.fail", { key, message: err?.message });
    return null;
  }
}

// ------------------------------------------------------------
// 🔁 Safe feed generation with one retry
// ------------------------------------------------------------
async function safeGenerateFeed(bucket, items) {
  try {
    if (items?.[0]) {
      debug("🧩 feed preview", {
        title: items[0]?.shortTitle || items[0]?.title,
        link: items[0]?.shortUrl || items[0]?.link,
        hasRewritten: !!items[0]?.rewritten,
      });
    }

    await generateFeed(bucket, items);
    debug("rss-feed-creator.generateFeed.success", { bucket, items: items.length });
  } catch (err) {
    error("rss-feed-creator.generateFeed.fail", { message: err?.message });

    // retry once after 2s
    await new Promise((r) => setTimeout(r, 2000));
    await generateFeed(bucket, items);
    debug("rss-feed-creator.generateFeed.retry.success", { bucket });
  }
}
