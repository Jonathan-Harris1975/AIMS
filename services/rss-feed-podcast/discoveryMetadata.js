// ============================================================
// Podcast discovery metadata helpers
// ============================================================
// Search/discovery support for Apple, Spotify, YouTube Podcasts,
// RSS directories and Podcasting 2.0 consumers. This is deliberately
// supportive metadata, not keyword-stuffing or platform-specific magic.

import { THRESHOLDS } from "../../config/thresholds.js";
import { validatePodcastMetadata } from "../content-quality/validators/metadataValidator.js";

const DEFAULT_CHANNEL_TERMS = [
  "artificial intelligence",
  "AI podcast",
  "AI news",
  "AI governance",
  "AI ethics",
  "AI automation",
  "technology podcast",
  "Jonathan Harris",
  "Turing's Torch",
];

const GENERIC_OR_NOISY_TERMS = new Set([
  "ai",
  "tech",
  "news",
  "weekly",
  "podcast",
  "update",
  "updates",
  "latest",
  "breakthroughs",
  "technology",
  "gen x",
]);

// Previously hard-coded at 12; sourced from config/thresholds.js so the cap
// is a single documented knob (VALIDATOR_METADATA_MAX_KEYWORDS). Default
// trimmed to 6 curated terms per audit OB-005 / BSC-OB-006.
const MAX_LEGACY_ITUNES_TERMS = THRESHOLDS.validators.metadataMaxKeywords;
const MAX_LEGACY_ITUNES_CHARS = 255;

function normaliseWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitKeywordInput(input) {
  if (Array.isArray(input)) return input.flatMap(splitKeywordInput);
  if (input == null) return [];
  return String(input)
    .split(/[,;\n|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normaliseDiscoveryTerm(value = "") {
  let term = normaliseWhitespace(value)
    .replace(/^a+artificial intelligence\b/i, "artificial intelligence")
    .replace(/^open\s+ai\b/i, "OpenAI")
    .replace(/\bturings\s+torch\b/i, "Turing's Torch")
    .replace(/\bturing\s+torch\b/i, "Turing's Torch")
    .replace(/\bchatgpt\b/i, "ChatGPT")
    .replace(/\bllm\b/i, "LLM")
    .replace(/\bgpt\b/i, "GPT")
    .replace(/\bmcp\b/i, "MCP")
    .replace(/\bai\b/gi, "AI");

  // Keep natural search phrases. Strip decoration, hashtags and noisy punctuation,
  // but preserve apostrophes for Turing's Torch and hyphens inside normal words.
  term = term
    .replace(/^#+/, "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[^\p{L}\p{N}\s.'&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!term) return "";
  if (term.length > 46) term = term.slice(0, 46).replace(/[\s,;:.]+$/, "");
  return term;
}

export function normaliseDiscoveryTerms(...inputs) {
  const seen = new Set();
  const out = [];
  for (const raw of inputs.flatMap(splitKeywordInput)) {
    const term = normaliseDiscoveryTerm(raw);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function scoreTerm(term = "", context = "") {
  const t = normaliseDiscoveryTerm(term);
  if (!t) return -999;
  const key = t.toLowerCase();
  const wordCount = key.split(/\s+/).filter(Boolean).length;
  let score = 0;
  if (context.toLowerCase().includes(key)) score += 8;
  if (wordCount >= 2) score += 4;
  if (wordCount >= 4) score -= 1;
  if (GENERIC_OR_NOISY_TERMS.has(key)) score -= 8;
  if (/\b(openai|anthropic|claude|chatgpt|gemini|deepseek|sora|veo|mcp|llm|gpt)\b/i.test(t)) score += 3;
  if (/\b(governance|ethics|automation|agents?|safety|privacy|data|models?|regulation|workflow|productivity|jobs?)\b/i.test(t)) score += 3;
  if (/jonathan harris|turing/i.test(t)) score += 2;
  return score;
}

export function rankDiscoveryTerms(terms = [], { context = "", maxTerms = 14 } = {}) {
  return normaliseDiscoveryTerms(terms)
    .map((term, index) => ({ term, index, score: scoreTerm(term, context) }))
    .filter((row) => row.score > -5)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((row) => row.term)
    .slice(0, maxTerms);
}

export function buildLegacyItunesKeywordsCsv(...inputs) {
  let options = {};
  const final = inputs[inputs.length - 1];
  if (final && typeof final === "object" && !Array.isArray(final)) {
    options = inputs.pop() || {};
  }
  const maxTerms = Number(options.maxTerms || MAX_LEGACY_ITUNES_TERMS);
  const maxChars = Number(options.maxChars || MAX_LEGACY_ITUNES_CHARS);
  const context = normaliseWhitespace(options.context || "");
  const fallback = options.fallback === false ? [] : DEFAULT_CHANNEL_TERMS;

  const ranked = rankDiscoveryTerms(normaliseDiscoveryTerms(...inputs, fallback), {
    context,
    maxTerms: Math.max(1, maxTerms * 2),
  });

  const selected = [];
  for (const term of ranked) {
    const candidate = [...selected, term].join(", ");
    if (selected.length >= maxTerms || candidate.length > maxChars) break;
    selected.push(term);
  }
  return selected.join(", ");
}

export function buildPodcastDiscoveryMetadata({
  title = "",
  description = "",
  mainOnly = "",
  keywords = [],
  keywordCandidates = [],
  categories = [],
  channelKeywords = [],
} = {}) {
  const context = normaliseWhitespace(`${title} ${description} ${mainOnly}`).slice(0, 6000);
  const seedTerms = normaliseDiscoveryTerms(keywordCandidates, keywords, channelKeywords, DEFAULT_CHANNEL_TERMS);
  const ranked = rankDiscoveryTerms(seedTerms, { context, maxTerms: 18 });
  const primaryTerms = ranked.slice(0, 8);
  const episodeTerms = ranked.slice(0, 14);
  const legacyItunesKeywordsCsv = buildLegacyItunesKeywordsCsv(episodeTerms, {
    context,
    maxTerms: MAX_LEGACY_ITUNES_TERMS,
    maxChars: MAX_LEGACY_ITUNES_CHARS,
    fallback: false,
  });
  const normalisedCategories = normaliseDiscoveryTerms(categories).slice(0, 4);
  const warnings = [];

  const metadataCheck = validatePodcastMetadata({
    itunesKeywords: legacyItunesKeywordsCsv,
    source: "rss-feed-podcast",
  });
  warnings.push(...metadataCheck.defects, ...metadataCheck.warnings);

  if (episodeTerms.length < 6) {
    warnings.push("Low keyword coverage: title, description and transcript content should expose more specific episode subjects.");
  }
  if (!/\bjonathan\s+harris\b/i.test(description)) {
    warnings.push("Description should mention Jonathan Harris once for host/entity clarity.");
  }
  if (!normalisedCategories.length) {
    warnings.push("Podcast category metadata was not supplied; category fit should remain explicitly configured in the feed environment.");
  }

  return {
    strategy: "supportive_metadata_not_keyword_stuffing",
    primaryTerms,
    episodeTerms,
    legacy: {
      itunesKeywordsCsv: legacyItunesKeywordsCsv,
      maxTerms: MAX_LEGACY_ITUNES_TERMS,
      maxCharacters: MAX_LEGACY_ITUNES_CHARS,
      policy: "optional legacy compatibility only; titles, descriptions, categories, transcripts and schema remain the main discovery surfaces",
    },
    platformGuidance: {
      apple: ["category", "show title", "episode title", "episode description", "transcript"],
      spotify: ["show title", "episode title", "show description", "episode description"],
      youtube: ["podcast playlist title", "playlist description", "video title", "video description"],
      rssDirectories: ["channel title", "channel description", "episode title", "episode description", "category", "legacy itunes keywords"],
      podcasting2: ["transcript", "chapters/topics when available", "person/entity metadata when available"],
    },
    categories: normalisedCategories,
    warnings,
  };
}

export const __testing = {
  DEFAULT_CHANNEL_TERMS,
  GENERIC_OR_NOISY_TERMS,
  splitKeywordInput,
  scoreTerm,
};
