// ============================================================
// 📊 Anti-hype batch-level flagged-share tracker
// ============================================================
//
// `THRESHOLDS.validators.antiHypeMaxFlaggedShare` (BSC-OB-003 target: "<3%
// of samples flagged") was defined and env-overridable but never read
// anywhere — `validateAntiHype` only ever flags defects per individual
// text, it never computed a flagged-share ratio across a batch. This
// module is that missing batch-level check.
//
// Deliberately in-memory and per-process rather than durable/shared: AIMS
// runs as a small set of long-lived processes, not a fleet, so a
// per-process rolling window is sufficient for the informational alert
// this tracker exists to raise. It is not a source of truth for analytics.
//
// Wiring: `validateAntiHype` calls `recordAntiHypeSample()` whenever it is
// called with `emit: true` (the same flag that already opts a call site
// into QA event persistence), so no call sites needed to change to pick
// this up.
// ============================================================

import { emitQaEvent } from "../../shared/utils/qaEvents.js";
import { THRESHOLDS } from "../../../config/thresholds.js";

const MAX_BUCKETS = 14; // ~2 weeks of daily buckets retained in memory
const MIN_SAMPLES_BEFORE_ALERT = 20; // avoid noisy alerts on tiny early-day sample counts

const buckets = new Map(); // "YYYY-MM-DD" -> { total, flagged }
let lastAlertDay = null;

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function pruneOldBuckets() {
  if (buckets.size <= MAX_BUCKETS) return;
  const days = [...buckets.keys()].sort();
  for (const day of days.slice(0, days.length - MAX_BUCKETS)) {
    buckets.delete(day);
  }
}

/**
 * Record one anti-hype validation sample toward the rolling batch-level
 * flagged-share checked against `THRESHOLDS.validators.antiHypeMaxFlaggedShare`.
 *
 * Emits at most one QA event per calendar day (the first sample that pushes
 * the day's rolling share over the threshold), rather than on every sample,
 * to avoid alert noise once a day is already flagged.
 *
 * @param {object} input
 * @param {boolean} input.flagged - Whether this individual sample had defects.
 * @param {string} [input.source] - Calling pipeline, for QA event attribution.
 */
export function recordAntiHypeSample({ flagged, source = "unknown" } = {}) {
  const day = dayKey();
  const bucket = buckets.get(day) || { total: 0, flagged: 0 };
  bucket.total += 1;
  if (flagged) bucket.flagged += 1;
  buckets.set(day, bucket);
  pruneOldBuckets();

  const share = bucket.total > 0 ? bucket.flagged / bucket.total : 0;
  const threshold = THRESHOLDS.validators.antiHypeMaxFlaggedShare;

  if (bucket.total >= MIN_SAMPLES_BEFORE_ALERT && share > threshold && lastAlertDay !== day) {
    lastAlertDay = day;
    emitQaEvent({
      source: `validator.anti-hype.batch.${source}`,
      type: "anti_hype_batch_rate_exceeded",
      severity: "medium",
      message: `Anti-hype flagged share ${(share * 100).toFixed(1)}% exceeds ${(threshold * 100).toFixed(1)}% target over ${bucket.total} samples today`,
      detail: { day, total: bucket.total, flagged: bucket.flagged, share, threshold },
      persist: true,
    });
  }

  return { day, total: bucket.total, flagged: bucket.flagged, share };
}

/** Return a snapshot of one day's bucket (defaults to today). */
export function getAntiHypeBatchSnapshot(day = dayKey()) {
  const bucket = buckets.get(day) || { total: 0, flagged: 0 };
  return { day, ...bucket, share: bucket.total > 0 ? bucket.flagged / bucket.total : 0 };
}

/** Test helper: reset in-memory state between test runs. */
export function _resetAntiHypeBatchTrackerForTests() {
  buckets.clear();
  lastAlertDay = null;
}

export default { recordAntiHypeSample, getAntiHypeBatchSnapshot };
