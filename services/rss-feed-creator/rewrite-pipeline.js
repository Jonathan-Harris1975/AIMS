// ============================================================
// 🧠 RSS Feed Creator — End-to-End Rewrite Pipeline (Shiper)
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

export async function endToEndRewrite() {
  try {
    info("rss-feed-creator.pipeline.start");

    // 1) Fetch source items
    const feedItems = await fetchAndParseFeeds();
    if (!Array.isArray(feedItems) || feedItems.length === 0) {
      debug("rss-feed-creator.pipeline.noItems", { reason: "no valid items" });
      return { totalItems: 0, rewrittenItems: 0 };
    }

    debug("rss-feed-creator.pipeline.fetch.complete", {
      items: feedItems.length,
      sampleTitle: feedItems[0]?.title,
    });

    // 2) Rewrite + enrich (adds shortTitle, shortUrl, rewritten, shortGuid, pubDate).
    // Phase 3 is fail-closed: dropped items are quarantined and never reach RSS.
    const { rewrittenItems, droppedItems, qualitySummary } = await rewriteRssFeedItemsWithQuality(feedItems);
    let phase3QuarantineKey = null;

    if (droppedItems.length) {
      phase3QuarantineKey = await safeQuarantinePhase3Drops({ droppedItems, qualitySummary, sourceCount: feedItems.length });
    }

    if (!Array.isArray(rewrittenItems) || rewrittenItems.length === 0) {
      throw new Error("Phase 3 blocked all RSS rewrite items; nothing safe to publish");
    }

    // Preview the first enriched item to confirm correct fields
    const first = rewrittenItems[0] || {};
    debug("rss-feed-creator.pipeline.sample", {
      shortTitle: first.shortTitle,
      shortUrl: first.shortUrl,
      guid: first.shortGuid,
      hasRewritten: !!first.rewritten,
    });

    debug("rss-feed-creator.batch.complete", {
      totalItems: feedItems.length,
      rewrittenItems: rewrittenItems.length,
      droppedItems: droppedItems.length,
      phase3Status: qualitySummary.status,
      phase3QuarantineKey,
    });

    // 3) Build + upload RSS using the ENRICHED array (not the originals)
    await safeGenerateFeed("rss", rewrittenItems);

    debug("rss-feed-creator.pipeline.done", {
      totalItems: feedItems.length,
      rewrittenItems: rewrittenItems.length,
      droppedItems: droppedItems.length,
      phase3Status: qualitySummary.status,
    });

    return {
      totalItems: feedItems.length,
      rewrittenItems: rewrittenItems.length,
      droppedItems: droppedItems.length,
      phase3Quality: qualitySummary,
      phase3QuarantineKey,
    };
  } catch (err) {
    error("rss-feed-creator.pipeline.fail", { message: err?.message, stack: err?.stack });
    throw err;
  }
}

async function safeQuarantinePhase3Drops({ droppedItems = [], qualitySummary = {}, sourceCount = 0 } = {}) {
  const key = phase3QuarantineKey({
    contentType: "rss-rewrite",
    id: `dropped-${droppedItems.length}-of-${sourceCount}`,
  });

  try {
    await putJson("rss", key, buildPhase3QuarantinePayload({
      context: {
        service: "rss-feed-creator",
        pipeline: "endToEndRewrite",
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
