// ============================================================
// 🗂️ Metadata validator
// ============================================================
// Guards against overloaded/keyword-stuffed discovery metadata
// (audit OB-005, BSC-OB-006): itunesKeywords lists that exceed the curated
// cap, or contain duplicate terms across recent episodes.
// ============================================================

import { emitQaEvent } from "../../shared/utils/qaEvents.js";
import { THRESHOLDS } from "../../../config/thresholds.js";

function parseKeywordList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[,;]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Validate a podcast episode's discovery/keyword metadata.
 *
 * @param {object} input
 * @param {string|string[]} input.itunesKeywords - CSV string or array.
 * @param {string[]} [input.recentEpisodeKeywordSets] - Previous episodes'
 *   keyword lists (CSV strings or arrays), for cross-episode duplicate checks.
 * @param {number} [input.maxKeywords] - Override THRESHOLDS.validators.metadataMaxKeywords.
 */
export function validatePodcastMetadata({
  itunesKeywords = "",
  recentEpisodeKeywordSets = [],
  maxKeywords = THRESHOLDS.validators.metadataMaxKeywords,
  source = "unknown",
  emit = false,
} = {}) {
  const terms = parseKeywordList(itunesKeywords);
  const warnings = [];
  const defects = [];

  const uniqueTerms = new Set(terms.map((term) => term.toLowerCase()));
  if (uniqueTerms.size !== terms.length) {
    defects.push(`itunesKeywords contains duplicate term(s) within the same episode (${terms.length - uniqueTerms.size} duplicate(s)).`);
  }

  if (terms.length > maxKeywords) {
    defects.push(`itunesKeywords has ${terms.length} term(s); maximum curated cap is ${maxKeywords}.`);
  }

  const recentTermSets = (Array.isArray(recentEpisodeKeywordSets) ? recentEpisodeKeywordSets : [])
    .map(parseKeywordList)
    .map((list) => new Set(list.map((term) => term.toLowerCase())));

  if (recentTermSets.length) {
    const repeatedAcrossAllRecent = terms.filter((term) =>
      recentTermSets.every((set) => set.has(term.toLowerCase()))
    );
    if (repeatedAcrossAllRecent.length && repeatedAcrossAllRecent.length === terms.length) {
      warnings.push(
        `itunesKeywords is identical to the last ${recentTermSets.length} episode(s); vary curated terms per episode.`
      );
    }
  }

  const result = {
    ok: defects.length === 0,
    defects,
    warnings,
    termCount: terms.length,
    maxKeywords,
    terms,
  };

  if (emit && (defects.length || warnings.length)) {
    emitQaEvent({
      source: `validator.metadata.${source}`,
      type: "metadata_overload",
      severity: defects.length ? "medium" : "low",
      message: `${defects.length} metadata defect(s), ${warnings.length} warning(s)`,
      detail: result,
    });
  }

  return result;
}

/**
 * Trim a curated keyword list down to the configured cap, preserving order
 * (assumes callers already rank by relevance before trimming).
 */
export function trimKeywordsToLimit(itunesKeywords = "", maxKeywords = THRESHOLDS.validators.metadataMaxKeywords) {
  const terms = parseKeywordList(itunesKeywords);
  const seen = new Set();
  const trimmed = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    trimmed.push(term);
    if (trimmed.length >= maxKeywords) break;
  }
  return trimmed;
}

export default { validatePodcastMetadata, trimKeywordsToLimit };
