// ============================================================
// 🛡️ Anti-hype validator
// ============================================================
// Flags generic newsroom/PR abstractions ("landscape", "revolution",
// "paradigm", "game-changer", "transform", "unprecedented") and the existing
// BANNED_PROMO_PATTERNS/hedging-phrase lists, per audit findings OB-002,
// OB-010, BSC-OB-003.
//
// Modular by design: this validator can be called from the OneUp social
// gate, the RSS rewrite pipeline, or the podcast script gate without any of
// them needing to know about each other.
// ============================================================

import {
  ANTI_HYPE_HEDGING_PHRASES,
  BANNED_PROMO_PATTERNS,
  findAmericanSpellings,
  findGenericAbstractionBreaches,
  findPatternBreaches,
} from "../brandLexicon.js";
import { emitQaEvent } from "../../shared/utils/qaEvents.js";
import { recordAntiHypeSample } from "./antiHypeBatchTracker.js";

function findPlainPhraseBreaches(text = "", phrases = []) {
  const source = String(text || "").toLowerCase();
  return phrases.filter((phrase) => source.includes(String(phrase).toLowerCase()));
}

/**
 * @param {string} text - Text to validate.
 * @param {object} [options]
 * @param {string} [options.source] - Calling pipeline, for QA event attribution.
 * @param {boolean} [options.checkBritishSpelling]
 * @param {boolean} [options.emit] - Emit a structured QA event when defects are found.
 */
export function validateAntiHype(text = "", { source = "unknown", checkBritishSpelling = false, emit = false } = {}) {
  const defects = [];
  const genericAbstractions = findGenericAbstractionBreaches(text);
  for (const term of genericAbstractions) {
    defects.push(
      `Generic abstraction phrase detected: "${term}". Replace with a concrete effect ` +
        `(what specifically changes: who/what/impact) in the same sentence.`
    );
  }
  for (const breach of findPatternBreaches(text, BANNED_PROMO_PATTERNS)) {
    defects.push(`Brand tone breach: ${breach}`);
  }
  for (const phrase of findPlainPhraseBreaches(text, ANTI_HYPE_HEDGING_PHRASES)) {
    defects.push(`Generic hedging phrase detected: ${phrase}`);
  }
  if (checkBritishSpelling) {
    for (const { american, british } of findAmericanSpellings(text)) {
      defects.push(`British English drift: use ${british} instead of ${american}`);
    }
  }

  const result = {
    ok: defects.length === 0,
    defects,
    genericAbstractions,
  };

  if (emit) {
    // Batch-level flagged-share tracking (BSC-OB-003 target: <3% of samples
    // flagged) needs every sample, including clean ones, to compute a real
    // ratio — not just the ones with defects.
    recordAntiHypeSample({ flagged: defects.length > 0, source });
  }

  if (emit && defects.length) {
    emitQaEvent({
      source: `validator.anti-hype.${source}`,
      type: "anti_hype_defects",
      severity: "medium",
      message: `${defects.length} anti-hype defect(s) found`,
      detail: { defects, genericAbstractions, textSample: String(text || "").slice(0, 200) },
    });
  }

  return result;
}

export default { validateAntiHype };
