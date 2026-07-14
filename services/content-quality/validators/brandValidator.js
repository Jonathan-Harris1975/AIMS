// ============================================================
// 🎨 Brand validator
// ============================================================
// Modular wrapper around the existing brand-lexicon checks (British
// spelling, banned promo patterns, motivational tone, engagement bait,
// generic/motivational hashtags) so any pipeline stage — not just the
// Zernio social gate — can run the same brand checks consistently.
//
// This does not change the behaviour of the existing Zernio gate
// (runZernioSocialGate in socialScheduler.js keeps its own inline checks for
// backwards compatibility); it gives new and future call sites a single
// reusable entry point instead of re-implementing the same regex sweeps.
// ============================================================

import {
  ENGAGEMENT_BAIT_PATTERNS,
  GENERIC_HASHTAGS,
  MOTIVATIONAL_HASHTAGS,
  MOTIVATIONAL_TONE_PATTERNS,
  findAmericanSpellings,
  findPatternBreaches,
} from "../brandLexicon.js";
import { emitQaEvent } from "../../shared/utils/qaEvents.js";

function extractHashtags(value = "") {
  return [...String(value || "").matchAll(/(^|\s)(#[A-Za-z0-9_]+)/g)].map((match) => match[2]);
}

export function validateBrand(text = "", { source = "unknown", maxHashtags = 3, emit = false } = {}) {
  const defects = [];
  const warnings = [];
  const hashtags = extractHashtags(text);

  if (hashtags.length > maxHashtags) {
    defects.push(`More than ${maxHashtags} hashtags used (${hashtags.length}).`);
  }
  const genericTags = hashtags.filter((tag) => GENERIC_HASHTAGS.includes(tag.toLowerCase()));
  if (genericTags.length > 1) warnings.push("More than one generic hashtag used; keep premium channels tidy.");
  const motivationalTags = hashtags.filter((tag) => MOTIVATIONAL_HASHTAGS.includes(tag.toLowerCase()));
  if (motivationalTags.length) defects.push(`Motivational hashtag(s) do not fit the brand: ${motivationalTags.join(", ")}`);

  for (const breach of findPatternBreaches(text, MOTIVATIONAL_TONE_PATTERNS)) {
    defects.push(`Motivational tone drift: ${breach}`);
  }
  for (const breach of findPatternBreaches(text, ENGAGEMENT_BAIT_PATTERNS)) {
    defects.push(`Engagement bait detected: ${breach}`);
  }
  for (const { american, british } of findAmericanSpellings(text)) {
    defects.push(`British English drift: use ${british} instead of ${american}`);
  }
  if (/```|\*\*|^\s*[-*]\s+/m.test(text)) defects.push("Contains markdown or bullet formatting.");
  if (/\p{Extended_Pictographic}/u.test(text)) defects.push("Contains emoji despite brand rules.");

  const result = { ok: defects.length === 0, defects, warnings, hashtags };

  if (emit && defects.length) {
    emitQaEvent({
      source: `validator.brand.${source}`,
      type: "brand_defects",
      severity: "medium",
      message: `${defects.length} brand defect(s) found`,
      detail: result,
    });
  }

  return result;
}

export default { validateBrand };
