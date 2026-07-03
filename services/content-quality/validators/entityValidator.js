// ============================================================
// 🏷️ Entity preservation validator
// ============================================================
// Lightweight, dependency-free named-entity heuristic used to catch
// "thin entity context" summaries (audit OB-003, OB-007/008/009,
// BSC-OB-004): RSS/podcast rewrites that drop the specific company,
// person, project or technology named in the source text.
//
// This is intentionally a heuristic, not a full NER model — it looks for
// Title-Case word runs and short ALLCAPS acronyms, which is sufficient to
// gate "did we keep at least one concrete named thing" without adding a new
// model dependency to the pipeline.
// ============================================================

import { emitQaEvent } from "../../shared/utils/qaEvents.js";
import { THRESHOLDS } from "../../../config/thresholds.js";

const SENTENCE_START_STOPWORDS = new Set([
  "the", "this", "that", "these", "those", "it", "its", "a", "an", "and", "but", "or",
  "so", "yet", "for", "while", "when", "if", "as", "in", "on", "at", "by", "with",
  "after", "before", "meanwhile", "however", "still", "now", "today", "meanwhile,",
]);

const GENERIC_ENTITY_STOPWORDS = new Set([
  "ai", "the ai", "artificial intelligence", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday", "january", "february", "march",
  "april", "may", "june", "july", "august", "september", "october", "november",
  "december",
]);

function splitSentences(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
}

function extractCapitalisedRuns(sentence = "") {
  const words = sentence.split(/\s+/).filter(Boolean);
  const runs = [];
  let current = [];

  words.forEach((rawWord, index) => {
    const word = rawWord.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    const isAcronym = /^[A-Z0-9]{2,8}$/.test(word) && /[A-Z]/.test(word);
    // Covers plain Title Case ("Sam"), brand/mixed case ("OpenAI", "ChatGPT")
    // and alphanumeric product names ("GPT-5", "Claude4"): starts with a
    // capital letter, contains only letters/digits/apostrophe/hyphen, and is
    // at least 2 characters.
    const isCapitalisedToken = /^[A-Z][A-Za-z0-9'-]+$/.test(word) && word.length >= 2;
    const isSentenceStart = index === 0;

    if ((isAcronym || isCapitalisedToken) && !(isSentenceStart && SENTENCE_START_STOPWORDS.has(word.toLowerCase()))) {
      current.push(word);
    } else if (current.length) {
      runs.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) runs.push(current.join(" "));
  return runs;
}

/**
 * Extract candidate named entities from free text.
 * @returns {string[]} deduplicated, order-preserved entity strings.
 */
export function extractNamedEntities(text = "") {
  const seen = new Set();
  const out = [];
  for (const sentence of splitSentences(text)) {
    for (const run of extractCapitalisedRuns(sentence)) {
      const key = run.toLowerCase();
      if (GENERIC_ENTITY_STOPWORDS.has(key)) continue;
      if (run.length < 2) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(run);
    }
  }
  return out;
}

export function countNamedEntities(text = "") {
  return extractNamedEntities(text).length;
}

/**
 * Decide whether a rewritten summary needs an entity-preservation
 * regeneration pass, mirroring the audit's exact guardrail:
 * "if summary <40 words and namedEntityCount <=1, require a regeneration
 * pass asking 'which organisation, person or technology matters here?'"
 */
export function requiresEntityRegeneration(summary = "", { wordCount } = {}) {
  const words = Number.isFinite(wordCount)
    ? wordCount
    : String(summary || "").trim().split(/\s+/).filter(Boolean).length;
  const entityCount = countNamedEntities(summary);
  const needsRegeneration =
    words < THRESHOLDS.validators.entityMinWordsForCheck && entityCount <= THRESHOLDS.validators.entityMinCount;
  return { needsRegeneration, entityCount, wordCount: words };
}

/**
 * Validate that a rewritten/summarised text preserved at least one named
 * entity that was present in the source text (when the source had any).
 */
export function validateEntityPreservation({ sourceText = "", outputText = "", source = "unknown", emit = false } = {}) {
  const sourceEntities = extractNamedEntities(sourceText);
  const outputEntities = extractNamedEntities(outputText);
  const preservedEntities = sourceEntities.filter((entity) =>
    outputEntities.some((candidate) => candidate.toLowerCase() === entity.toLowerCase())
  );

  const regenerationCheck = requiresEntityRegeneration(outputText);

  const result = {
    ok: !regenerationCheck.needsRegeneration,
    sourceEntityCount: sourceEntities.length,
    outputEntityCount: outputEntities.length,
    preservedEntities,
    needsRegeneration: regenerationCheck.needsRegeneration,
    regenerationPrompt: regenerationCheck.needsRegeneration
      ? "Which organisation, person or technology matters here? Add one."
      : null,
  };

  if (emit && !result.ok) {
    emitQaEvent({
      source: `validator.entity.${source}`,
      type: "thin_entity_context",
      severity: "low",
      message: `Output has ${result.outputEntityCount} named entit${result.outputEntityCount === 1 ? "y" : "ies"}; regeneration recommended`,
      detail: result,
    });
  }

  return result;
}

export default { extractNamedEntities, countNamedEntities, requiresEntityRegeneration, validateEntityPreservation };
