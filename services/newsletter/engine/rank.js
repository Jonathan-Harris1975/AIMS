// services/newsletter/engine/rank.js
//
// Ranks candidate stories and selects the lead story + top N summary slots.
// Deliberately simple and transparent (recency + source diversity + light
// keyword signal) rather than a black-box score, so an editor can reason
// about why a story was chosen. Pure function — no network, no AI call —
// so it is fully unit-testable.

const AI_SIGNAL_TERMS = [
  "openai", "anthropic", "claude", "gpt", "gemini", "llm", "large language model",
  "artificial intelligence", "machine learning", "generative ai", "chatgpt",
  "microsoft ai", "google ai", "meta ai", "nvidia", "deepmind", "mistral",
  "copilot", "agent", "model release", "foundation model",
];

function configuredBlockedDomains() {
  return new Set(
    String(process.env.NEWSLETTER_BLOCKED_SOURCE_DOMAINS || "robotwritersai.com")
      .split(",")
      .map((value) => value.trim().toLowerCase().replace(/^www\./, ""))
      .filter(Boolean),
  );
}

function sourceHostname(item = {}) {
  for (const candidate of [item.link, item.sourceFeed]) {
    try { return new URL(candidate).hostname.toLowerCase().replace(/^www\./, ""); } catch {}
  }
  return "";
}

export function assessNewsletterSourceQuality(item = {}) {
  const hostname = sourceHostname(item);
  const blockedDomains = configuredBlockedDomains();
  const blockedDomain = [...blockedDomains].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  const link = String(item.link || "").toLowerCase();
  const promotionalPath = /newsletter-template|speech-promotion|sponsored-post|press-release/.test(link);
  const summary = String(item.summary || "").trim();
  const summaryWords = summary.split(/\s+/).filter(Boolean).length;
  const truncated = /(?:\.\.\.|…|\[…?\]|\[truncated\])\s*$/i.test(summary) || /content truncated/i.test(summary);
  const bigThreeEligible = !blockedDomain && !promotionalPath && !truncated && summaryWords >= 35;

  return {
    hostname,
    blockedDomain,
    promotionalPath,
    truncated,
    summaryWords,
    bigThreeEligible,
    publishEligible: !blockedDomain && !promotionalPath,
  };
}

function scoreItem(item, { now = new Date() } = {}) {
  let score = 0;

  // Recency: newer stories score higher, linearly decayed across the window.
  if (item.publishedAt) {
    const ageHours = Math.max(0, (now - new Date(item.publishedAt)) / (60 * 60 * 1000));
    score += Math.max(0, 24 - ageHours) * 2;
  }

  // Topical relevance: reward stories that actually mention AI-industry terms
  // in title or summary, so an off-topic item from a mixed-content feed
  // doesn't crowd out real AI news.
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  const hits = AI_SIGNAL_TERMS.filter((term) => haystack.includes(term)).length;
  score += Math.min(hits, 5) * 4;

  // Evidence quality is part of editorial relevance. Complete, attributable
  // summaries are promoted into the Big Three; truncated or thin records remain
  // available only for lower-risk slots rather than poisoning the repair loop.
  const quality = assessNewsletterSourceQuality(item);
  if (item.summary && item.summary.length > 120) score += 3;
  if (quality.bigThreeEligible) score += 40;
  if (quality.truncated) score -= 35;
  if (quality.summaryWords < 20) score -= 12;

  return score;
}

/**
 * @param {Array} items normalised RSS items (see engine/rss.js)
 * @param {Object} options
 * @param {number} options.storyCount how many top-N summary stories to select (excludes the lead)
 * @param {number} [options.maxPerSourceFeed] source-diversity cap
 */
export function rankAndSelectStories(items, { storyCount, maxPerSourceFeed = 3, now = new Date() } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return { lead: null, stories: [], droppedForDiversity: [], droppedForQuality: [] };
  }

  const droppedForQuality = [];
  const scored = items
    .map((item) => {
      const sourceQuality = assessNewsletterSourceQuality(item);
      return { item: { ...item, sourceQuality, bigThreeEligible: sourceQuality.bigThreeEligible }, sourceQuality, score: scoreItem(item, { now }) };
    })
    .filter((entry) => {
      if (entry.sourceQuality.publishEligible) return true;
      droppedForQuality.push({ ...entry.item, qualityReason: entry.sourceQuality.blockedDomain ? "blocked-domain" : "promotional-source" });
      return false;
    })
    .sort((a, b) => b.score - a.score);

  const perFeedCount = new Map();
  const selected = [];
  const droppedForDiversity = [];

  for (const { item, score } of scored) {
    const feedCount = perFeedCount.get(item.sourceFeed) || 0;
    if (feedCount >= maxPerSourceFeed) {
      droppedForDiversity.push(item);
      continue;
    }
    perFeedCount.set(item.sourceFeed, feedCount + 1);
    selected.push({ ...item, rankScore: score });
    if (selected.length >= storyCount + 1) break;
  }

  const [lead, ...stories] = selected;

  return {
    lead: lead || null,
    stories,
    droppedForDiversity,
    droppedForQuality,
    totalCandidates: items.length,
  };
}

export default { rankAndSelectStories };
