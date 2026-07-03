// ============================================================
// 🧩 Content-quality validators — barrel export
// ============================================================
// Modular validator suite implementing the audit's future-facing
// recommendations. Each validator is independent and side-effect free
// aside from optional structured QA event emission (`emit: true`).
//
// Extension point: add new validators as their own file in this directory
// and re-export them here. Compose ad-hoc combinations with runValidators()
// rather than adding cross-imports between individual validator files.
// ============================================================

import { validateAntiHype } from "./antiHypeValidator.js";
import { validateEntityPreservation, requiresEntityRegeneration, extractNamedEntities } from "./entityValidator.js";
import { validatePodcastMetadata, trimKeywordsToLimit } from "./metadataValidator.js";
import { validateSpokenCadence } from "./spokenCadenceValidator.js";
import { validateBrand } from "./brandValidator.js";
import { emitQaEvent } from "../../shared/utils/qaEvents.js";

export {
  validateAntiHype,
  validateEntityPreservation,
  requiresEntityRegeneration,
  extractNamedEntities,
  validatePodcastMetadata,
  trimKeywordsToLimit,
  validateSpokenCadence,
  validateBrand,
};

/**
 * Run a chosen subset of validators against one piece of text and return a
 * combined report. Any validator can be skipped by omitting its config key.
 *
 * @example
 * runValidators({
 *   source: "oneup-daily-monday",
 *   text: post.content,
 *   antiHype: {},
 *   brand: {},
 * });
 */
export function runValidators({
  source = "unknown",
  text = "",
  sourceText = null,
  antiHype = null,
  entity = null,
  metadata = null,
  spokenCadence = null,
  brand = null,
  emit = true,
} = {}) {
  const reports = {};
  const allDefects = [];

  if (antiHype) {
    reports.antiHype = validateAntiHype(text, { source, emit, ...antiHype });
    allDefects.push(...reports.antiHype.defects);
  }
  if (entity) {
    reports.entity = validateEntityPreservation({ sourceText: sourceText || "", outputText: text, source, emit, ...entity });
    if (!reports.entity.ok) allDefects.push(reports.entity.regenerationPrompt || "Entity preservation check failed.");
  }
  if (metadata) {
    reports.metadata = validatePodcastMetadata({ source, emit, ...metadata });
    allDefects.push(...reports.metadata.defects);
  }
  if (spokenCadence) {
    reports.spokenCadence = validateSpokenCadence(text, { source, emit, ...spokenCadence });
    allDefects.push(...reports.spokenCadence.defects);
  }
  if (brand) {
    reports.brand = validateBrand(text, { source, emit, ...brand });
    allDefects.push(...reports.brand.defects);
  }

  const ok = allDefects.length === 0;

  if (emit) {
    emitQaEvent({
      source: `validators.composite.${source}`,
      type: ok ? "composite_pass" : "composite_defects",
      severity: ok ? "info" : "medium",
      message: ok ? "All requested validators passed" : `${allDefects.length} defect(s) across requested validators`,
      detail: { reports: Object.fromEntries(Object.entries(reports).map(([key, value]) => [key, { ok: value.ok }])) },
    });
  }

  return { ok, defects: allDefects, reports };
}

export default {
  validateAntiHype,
  validateEntityPreservation,
  requiresEntityRegeneration,
  extractNamedEntities,
  validatePodcastMetadata,
  trimKeywordsToLimit,
  validateSpokenCadence,
  validateBrand,
  runValidators,
};
