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
import { createShortLink } from "../../rss-links/service.js";
import {
  assertPhase3AutopublishGate,
  summarisePhase3Reports,
} from "../../content-quality/phase3Gates.js";

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

function buildPhase3RepairMessages({
  systemPrompt,
  userPrompt,
  rewrittenTitle,
  rewrittenSummary,
  phase3Report,
} = {}) {
  const defects = Array.isArray(phase3Report?.defects)
    ? phase3Report.defects.slice(0, 8)
    : [];

  return [
    {
      role: "system",
      content: [
        String(systemPrompt),
        "",
        "PHASE 3 REPAIR MODE:",
        "You are repairing an RSS rewrite so it passes deterministic auto-publish gates.",
        "Keep the Jonathan Harris voice, but fix only the listed gate defects.",
        "Do not add new facts, numbers, rankings, dates, prices, quotes, entities or claims.",
        "No double quotation marks anywhere in the output.",
        "Paraphrase quoted labels and slogans instead of quoting them.",
        "Keep numeric expressions exactly as written in the source title/text.",
        "Split any sentence over 32 words.",
        "Return only headline, blank line, summary.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        String(userPrompt),
        "",
        "Current candidate that failed the gate:",
        "Headline:",
        String(rewrittenTitle || ""),
        "",
        "Summary:",
        String(rewrittenSummary || ""),
        "",
        "Gate defects to fix:",
        defects.length ? defects.map((defect) => `- ${defect}`).join("\n") : "- Unknown Phase 3 failure",
        "",
        "Rewrite the candidate once. Keep the same subject and source-backed facts. Return only headline, blank line, summary.",
      ].join("\n"),
    },
  ];
}

function assertTopicGuardOrThrow({ title, sourceText, rewrittenTitle, rewrittenSummary } = {}) {
  const score = topicOverlapScore(`${title}\n${sourceText}`, `${rewrittenTitle}\n${rewrittenSummary}`);
  if (score.shared < TOPIC_GUARD_MIN_SHARED || score.overlap < TOPIC_GUARD_MIN_OVERLAP) {
    throw new Error(
      `Topic drift detected (shared=${score.shared}, overlap=${score.overlap.toFixed(3)}; ` +
        `minShared=${TOPIC_GUARD_MIN_SHARED}, minOverlap=${TOPIC_GUARD_MIN_OVERLAP})`
    );
  }
  return score;
}

function runPhase3Gate({ title, sourceText, item, link, rewrittenTitle, rewrittenSummary } = {}) {
  return assertPhase3AutopublishGate({
    contentType: "rss-rewrite",
    title: rewrittenTitle,
    summary: rewrittenSummary,
    bodyText: rewrittenSummary,
    sourceText: `${title}
${sourceText}`,
    sourceItems: [item],
    sources: [{ title, link }],
    themes: keywords(`${title}
${sourceText}`).slice(0, 6),
  });
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
  let rewrittenTitle = RSS_PROMPTS.clampTitleTo12Words(parsed.title || title, 12);
  let rewrittenSummary = RSS_PROMPTS.clampSummaryToWindow(
    parsed.summary || "",
    RSS_PROMPTS.MIN_SUMMARY_CHARS,
    RSS_PROMPTS.MAX_SUMMARY_CHARS
  );

  // Anti-fluff guard (one retry): prevent press-release phrasing from leaking into the feed.
  let bannedPhrases = RSS_PROMPTS.findBannedSummaryPhrases(rewrittenSummary);

  if (bannedPhrases.length) {
    debug("rss-feed-creator.model.output.fluffDetected", {
      matched: bannedPhrases.slice(0, 5),
    });

    const retryMessages = [
      {
        role: "system",
        content:
          String(systemPrompt) +
          "\n\nHARD RULE: Avoid press-release/editorial filler. Output must sound spoken and blunt.",
      },
      {
        role: "user",
        content:
          String(userPrompt) +
          "\n\nRewrite again, tighter and more spoken. Do NOT use any of these phrases (or close variants): " +
          RSS_PROMPTS.BANNED_SUMMARY_PHRASES.join(", "),
      },
    ];

    const raw2 = await resilientRequest("rssRewrite", {
      messages: retryMessages,
      temperature: 0.55,
      max_tokens: 900,
    });

    const parsed2 = RSS_PROMPTS.normalizeModelText(raw2);
    const t2 = RSS_PROMPTS.clampTitleTo12Words(parsed2.title || rewrittenTitle, 12);
    const s2 = RSS_PROMPTS.clampSummaryToWindow(
      parsed2.summary || rewrittenSummary,
      RSS_PROMPTS.MIN_SUMMARY_CHARS,
      RSS_PROMPTS.MAX_SUMMARY_CHARS
    );

    if (s2 && s2.length >= RSS_PROMPTS.MIN_SUMMARY_CHARS) {
      rewrittenTitle = t2;
      rewrittenSummary = s2;
    }

    bannedPhrases = RSS_PROMPTS.findBannedSummaryPhrases(rewrittenSummary);
    if (bannedPhrases.length) {
      throw new Error(
        `Rewrite contains banned filler after retry: ${bannedPhrases.slice(0, 5).join(", ")}`
      );
    }
  }

  // Validate format + brand constraints
  const v = RSS_PROMPTS.validateOutput(rewrittenTitle, rewrittenSummary, {
    maxTitleWords: 12,
    minChars: RSS_PROMPTS.MIN_SUMMARY_CHARS,
    maxChars: RSS_PROMPTS.MAX_SUMMARY_CHARS,
  });
  if (!v.valid) {
    throw new Error(`Rewrite format invalid: ${v.errors.join("; ")}`);
  }

  // 3) Topic-consistency guard
  let score = assertTopicGuardOrThrow({ title, sourceText, rewrittenTitle, rewrittenSummary });

  // 4) Phase 3 auto-publish gate. This is the no-manual-review safety net:
  // publish only when deterministic brand, source and structure gates pass.
  // If the first attempt is close but shaped badly for the deterministic gate
  // (quotes, converted numbers, long sentences), repair once before quarantine.
  let phase3Quality;
  try {
    phase3Quality = runPhase3Gate({
      title,
      sourceText,
      item,
      link,
      rewrittenTitle,
      rewrittenSummary,
    });
  } catch (err) {
    if (err?.name !== "Phase3AutopublishGateError" || !err?.phase3Report) {
      throw err;
    }

    warn("rss-feed-creator.model.phase3Repair.start", {
      title,
      score: err.phase3Report.score,
      defects: err.phase3Report.defects?.slice?.(0, 5) || [],
    });

    const repairRaw = await resilientRequest("rssRewrite", {
      messages: buildPhase3RepairMessages({
        systemPrompt,
        userPrompt,
        rewrittenTitle,
        rewrittenSummary,
        phase3Report: err.phase3Report,
      }),
      temperature: 0.35,
      max_tokens: 900,
    });

    const repaired = RSS_PROMPTS.normalizeModelText(repairRaw);
    const repairedTitle = RSS_PROMPTS.clampTitleTo12Words(repaired.title || rewrittenTitle, 12);
    const repairedSummary = RSS_PROMPTS.clampSummaryToWindow(
      repaired.summary || rewrittenSummary,
      RSS_PROMPTS.MIN_SUMMARY_CHARS,
      RSS_PROMPTS.MAX_SUMMARY_CHARS
    );

    const repairedValidation = RSS_PROMPTS.validateOutput(repairedTitle, repairedSummary, {
      maxTitleWords: 12,
      minChars: RSS_PROMPTS.MIN_SUMMARY_CHARS,
      maxChars: RSS_PROMPTS.MAX_SUMMARY_CHARS,
    });
    if (!repairedValidation.valid) {
      throw new Error(
        `Phase 3 repair output invalid: ${repairedValidation.errors.join("; ")}; original failure: ${err.message}`
      );
    }

    const repairedBannedPhrases = RSS_PROMPTS.findBannedSummaryPhrases(repairedSummary);
    if (repairedBannedPhrases.length) {
      throw new Error(
        `Phase 3 repair still contains banned filler: ${repairedBannedPhrases.slice(0, 5).join(", ")}; original failure: ${err.message}`
      );
    }

    score = assertTopicGuardOrThrow({
      title,
      sourceText,
      rewrittenTitle: repairedTitle,
      rewrittenSummary: repairedSummary,
    });

    phase3Quality = runPhase3Gate({
      title,
      sourceText,
      item,
      link,
      rewrittenTitle: repairedTitle,
      rewrittenSummary: repairedSummary,
    });

    rewrittenTitle = repairedTitle;
    rewrittenSummary = repairedSummary;

    debug("rss-feed-creator.model.phase3Repair.success", {
      title: rewrittenTitle,
      score: phase3Quality.score,
      topicGuard: score,
    });
  }

  // Create a self-hosted RSS short link (best-effort).
  // If R2-backed link creation fails, keep the original article URL and do not drop the item.
  let shortUrl = link;
  if (link) {
    try {
      const shortLink = await createShortLink(link);
      shortUrl = shortLink.shortUrl;
    } catch (e) {
      warn("rss-feed-creator.short-link.fail", { link, message: e?.message });
    }
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
    rewritten: RSS_PROMPTS.normalizeSummaryText(rewrittenSummary),
    shortTitle: RSS_PROMPTS.normalizePlainText(rewrittenTitle),
    shortUrl,
    shortGuid,
    pubDate: new Date().toUTCString(),
    phase3Quality: {
      ok: phase3Quality.ok,
      score: phase3Quality.score,
      threshold: phase3Quality.threshold,
      mode: phase3Quality.mode,
      status: phase3Quality.status,
      gateCount: phase3Quality.gates.length,
    },
  };
}

// ============================================================
// 🔹 Batch rewrite handler — drops failed items
// ============================================================

export async function rewriteRssFeedItemsWithQuality(feedItems = []) {
  const results = [];
  const droppedItems = [];
  const qualityReports = [];

  for (const item of feedItems) {
    if (!item || (!item.title && !item.summary)) continue;

    try {
      const rewritten = await rewriteArticle(item);
      results.push(rewritten);
      qualityReports.push(rewritten.phase3Quality);
    } catch (err) {
      const phase3Report = err?.phase3Report || null;
      const dropped = {
        title: item?.title || "Untitled",
        link: item?.link || "",
        reason: phase3Report ? "phase3-gate" : "rewrite-error",
        message: err?.message,
        phase3Report,
      };
      droppedItems.push(dropped);
      error("rss-feed-creator.model.item.dropped", {
        itemTitle: dropped.title,
        link: dropped.link,
        reason: dropped.reason,
        message: dropped.message,
        score: phase3Report?.score,
      });
      // HARD FAIL behaviour: do not include this item in the feed.
      continue;
    }
  }

  const phase3Summary = summarisePhase3Reports(qualityReports);
  const qualitySummary = {
    ...phase3Summary,
    // For operator reporting, total/passed/failed should reflect the whole
    // pipeline batch, not only the subset that reached Phase 3 scoring.
    // Rewrite errors and extraction failures are still dropped content.
    total: feedItems.length,
    passed: results.length,
    failed: droppedItems.length,
    sourceItems: feedItems.length,
    rewrittenItems: results.length,
    droppedItems: droppedItems.length,
    status: droppedItems.length ? "HAS_QUARANTINED_ITEMS" : "ALL_PASSED_AUTO_PUBLISH",
  };

  debug("rss-feed-creator.model.batch.complete", {
    totalItems: feedItems.length,
    rewrittenItems: results.length,
    dropped: droppedItems.length,
    phase3Status: qualitySummary.status,
    averageScore: qualitySummary.averageScore,
  });

  return { rewrittenItems: results, droppedItems, qualitySummary };
}

export async function rewriteRssFeedItems(feedItems = []) {
  const { rewrittenItems } = await rewriteRssFeedItemsWithQuality(feedItems);
  return rewrittenItems;
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

    const systemPrompt = [
      "You create clean Jonathan Harris RSS headlines for AI news items.",
      "Maximum 10 words.",
      "British, plain, sceptical, and human.",
      "No clickbait, no hype, no prefixes, no source names unless essential.",
      "Avoid formula templates such as 'X and the challenge of Y' or 'AI\'s X requires robust Y'.",
      "Output plain text only: no punctuation at the end, no emojis, no quotes."
    ].join(" ");

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

    const candidate = RSS_PROMPTS.clampTitleTo12Words(shortTitle, 10);
    const validation = RSS_PROMPTS.validateTitleBrand(candidate);
    if (!validation.valid) {
      throw new Error(`Generated short title failed brand validation: ${validation.errors.join("; ")}`);
    }

    return candidate.length > 80 ? `${candidate.slice(0, 77)}...` : candidate;
  } catch (err) {
    error("rss-feed-creator.shortTitle.fail", {
      route: "rssShortTitle",
      err: err?.message,
    });
    const fallback = RSS_PROMPTS.clampTitleTo12Words(item?.title || "Untitled Article", 10);
    const fallbackValidation = RSS_PROMPTS.validateTitleBrand(fallback);
    return fallbackValidation.valid ? fallback : "Untitled Article";
  }
}
