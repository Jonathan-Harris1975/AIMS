// ============================================================
// 🧠 RSS Feed Creator — AI Rewrite & Short Title Models
// ============================================================
//
// Fixes implemented:
// 1) Hard-fail when source text is missing/too short (no placeholder fallback).
// 2) Locked prompt for topic fidelity (uses rss-prompts SYSTEM + USER_ITEM).
// 3) Topic-consistency guard before publishing.
//
// Notes:
// - We parse model output into { title, summary } and only publish the summary.
// - We do NOT publish raw feed summaries as a fallback.
// ============================================================

import crypto from "crypto";
import { debug, error, warn } from "../../../logger.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { RSS_PROMPTS } from "./rss-prompts.js";
import { shortenUrl } from "./shortio.js";

// ─────────────────────────────────────────────
// ENV TUNABLES
// ─────────────────────────────────────────────
const MIN_SOURCE_CHARS = Number(process.env.RSS_MIN_SOURCE_CHARS || 220);
const TOPIC_GUARD_MIN_OVERLAP = Number(process.env.RSS_TOPIC_GUARD_MIN_OVERLAP || 0.12);
const TOPIC_GUARD_MIN_SHARED = Number(process.env.RSS_TOPIC_GUARD_MIN_SHARED || 2);

// ─────────────────────────────────────────────
// LIGHT HTML → TEXT NORMALISER
// ─────────────────────────────────────────────
function stripHtml(input = "") {
  return String(input)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────────────────────
// TOPIC GUARD
// ─────────────────────────────────────────────
const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","else","when","while","for","to","of","in","on","at","by","from","with","as",
  "is","are","was","were","be","been","being","it","this","that","these","those","its","their","they","them","we","you","your",
  "he","she","his","her","our","us","i","me","my","into","over","under","about","after","before","between","during","than","too",
  "can","could","may","might","will","would","should","must","also","just","more","most","less","least","much","many","some","any",
  "new","news","update","today","yesterday","tomorrow","said","says","according","report","reports","reported"
]);

function keywords(text = "") {
  const cleaned = stripHtml(text).toLowerCase();
  const parts = cleaned.split(/[^a-z0-9]+/g).filter(Boolean);
  const out = [];
  for (const p of parts) {
    if (p.length < 4) continue;
    if (STOPWORDS.has(p)) continue;
    out.push(p);
  }
  return out;
}

function topicOverlapScore(sourceText, outText) {
  const src = keywords(sourceText);
  const out = keywords(outText);
  const srcSet = new Set(src);
  const outSet = new Set(out);
  if (srcSet.size === 0 || outSet.size === 0) {
    return { overlap: 0, shared: 0, srcCount: srcSet.size, outCount: outSet.size };
  }
  let shared = 0;
  for (const w of srcSet) {
    if (outSet.has(w)) shared++;
  }
  // overlap ratio vs source vocabulary (more forgiving than full Jaccard)
  const overlap = shared / srcSet.size;
  return { overlap, shared, srcCount: srcSet.size, outCount: outSet.size };
}

// ============================================================
// 🔹 Rewrite article (rssRewrite route)
// ============================================================

export async function rewriteArticle(item = {}) {
  const title = String(item?.title || "").trim() || "Untitled article";
  const link = String(item?.link || "").trim();
  const summaryRaw = String(item?.summary || "").trim();

  // 1) Hard-fail: do NOT feed placeholders to the model.
  const sourceText = stripHtml(summaryRaw);
  if (!title && !sourceText) {
    throw new Error("Invalid feed item — missing title and summary");
  }
  if (!sourceText || sourceText.length < MIN_SOURCE_CHARS) {
    throw new Error(
      `Article extraction too thin (${sourceText?.length || 0} chars < ${MIN_SOURCE_CHARS})`
    );
  }

  // 2) Locked prompt (topic fidelity)
  const systemPrompt = RSS_PROMPTS?.SYSTEM || RSS_PROMPTS?.system;
  if (!systemPrompt) {
    throw new Error("RSS prompts not loaded (missing RSS_PROMPTS.SYSTEM)");
  }

  const userPrompt = RSS_PROMPTS.USER_ITEM({
    title,
    url: link,
    text: `${title}\n\n${sourceText}`,
    published: item?.pubDate || "",
  });

  const messages = [
    { role: "system", content: String(systemPrompt) },
    { role: "user", content: String(userPrompt) },
  ];

  debug("rss-feed-creator.model.input.preview", {
    title,
    link,
    sourceChars: sourceText.length,
    sourcePreview: sourceText.slice(0, 220),
  });

  const raw = await resilientRequest("rssRewrite", { messages });

  // Parse model output into title + summary
  const parsed = RSS_PROMPTS.normalizeModelText(raw);
  const rewrittenTitle = RSS_PROMPTS.clampTitleTo12Words(parsed.title || title, 12);
  const rewrittenSummary = RSS_PROMPTS.clampSummaryToWindow(
    parsed.summary || "",
    RSS_PROMPTS.MIN_SUMMARY_CHARS,
    RSS_PROMPTS.MAX_SUMMARY_CHARS
  );

  // Validate format constraints
  const v = RSS_PROMPTS.validateOutput(rewrittenTitle, rewrittenSummary, {
    maxTitleWords: 12,
    minChars: RSS_PROMPTS.MIN_SUMMARY_CHARS,
    maxChars: RSS_PROMPTS.MAX_SUMMARY_CHARS,
  });
  if (!v.valid) {
    throw new Error(`Rewrite format invalid: ${v.errors.join("; ")}`);
  }

  // 3) Topic-consistency guard
  const score = topicOverlapScore(`${title}\n${sourceText}`, `${rewrittenTitle}\n${rewrittenSummary}`);
  if (score.shared < TOPIC_GUARD_MIN_SHARED || score.overlap < TOPIC_GUARD_MIN_OVERLAP) {
    throw new Error(
      `Topic drift detected (shared=${score.shared}, overlap=${score.overlap.toFixed(3)}; ` +
        `minShared=${TOPIC_GUARD_MIN_SHARED}, minOverlap=${TOPIC_GUARD_MIN_OVERLAP})`
    );
  }

  // Shorten URL using Short.io (best-effort)
  let shortUrl = link;
  try {
    shortUrl = await shortenUrl(link);
  } catch (e) {
    warn("rss-feed-creator.shortio.fail", { message: e?.message });
  }

  // GUID
  const shortGuid = `ai-news-${crypto.randomBytes(5).toString("hex")}`;

  debug("rss-feed-creator.model.success", {
    route: "rssRewrite",
    title: rewrittenTitle,
    shortUrl,
    guid: shortGuid,
    topicGuard: score,
  });

  return {
    ...item,
    // publish summary only (feedGenerator will wrap it in HTML/CDATAs)
    rewritten: rewrittenSummary.trim(),
    shortTitle: rewrittenTitle,
    shortUrl,
    shortGuid,
    pubDate: new Date().toUTCString(),
  };
}

// ============================================================
// 🔹 Batch rewrite handler — drops failed items
// ============================================================

export async function rewriteRssFeedItems(feedItems = []) {
  const results = [];

  for (const item of feedItems) {
    if (!item || (!item.title && !item.summary)) continue;

    try {
      const rewritten = await rewriteArticle(item);
      results.push(rewritten);
    } catch (err) {
      error("rss-feed-creator.model.item.dropped", {
        itemTitle: item?.title || "Untitled",
        link: item?.link || "",
        message: err?.message,
      });
      // HARD FAIL behaviour: do not include this item in the feed.
      continue;
    }
  }

  debug("rss-feed-creator.model.batch.complete", {
    totalItems: feedItems.length,
    rewrittenItems: results.length,
    dropped: Math.max(0, (feedItems?.length || 0) - results.length),
  });

  return results;
}

// ============================================================
// 🔹 Optional: short title generator route (kept for API parity)
// ============================================================

export async function generateShortTitle(item = {}) {
  // Retained for backwards compatibility with your /rewrite route.
  // Not used by rewriteArticle() anymore (we use the model's title line).
  try {
    const title = String(item?.title || "").trim();
    const summary = String(item?.summary || "").trim();
    const rewritten = String(item?.rewritten || "").trim();

    if (!title && !summary && !rewritten) {
      throw new Error("No input content for rssShortTitle");
    }

    const systemPrompt =
      "You are an editorial assistant that creates short, catchy RSS titles for AI news items. Keep it under 10 words, no punctuation at the end, no emojis, no quotes, and output plain text only.";

    const userPrompt = [
      "Original title:",
      title,
      "",
      "Summary:",
      stripHtml(summary).slice(0, 1200),
      "",
      "Rewritten text:",
      stripHtml(rewritten).slice(0, 1200),
      "",
      "→ Output only the concise RSS title text.",
    ].join("\n");

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const result = await resilientRequest("rssShortTitle", { messages });
    const shortTitle = String(result || title || "Untitled Article")
      .replace(/[\r\n]+/g, " ")
      .replace(/^[-–—\s]+/, "")
      .replace(/^"|"$/g, "")
      .trim();

    return shortTitle.length > 80 ? shortTitle.slice(0, 77) + "..." : shortTitle;
  } catch (err) {
    error("rss-feed-creator.shortTitle.fail", {
      route: "rssShortTitle",
      err: err?.message,
    });
    return String(item?.title || "Untitled Article").slice(0, 80);
  }
}

// ============================================================
// 🔹 Export model route map
// ============================================================

export default {
  rssRewrite: rewriteArticle,
  rssShortTitle: generateShortTitle,
  rewriteRssFeedItems,
};
