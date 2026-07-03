// ============================================================
// 📋 Structured QA optimisation events
// ============================================================
//
// Every validator, the scheduler dedupe path, and the podcast artwork
// pipeline should emit one structured event per finding so future audits
// (and RAMS) can read a durable, machine-readable trail of what future
// guardrails caught, rather than free-text log lines only.
//
// This is deliberately additive: it does not replace the existing
// info()/warn()/error() logger calls used throughout the codebase, it
// gives them a consistent envelope (`qa.event`) plus an optional best-effort
// persisted copy in the "audits" R2 bucket for a human-reviewable QA queue.
//
// Extension point: call `emitQaEvent()` from any new validator or pipeline
// stage. Persistence is best-effort and never throws.
// ============================================================

import { info, warn, error as logError } from "../../../logger.js";
import { THRESHOLDS } from "../../../config/thresholds.js";

let uploadTextRef = null;
async function getUploadText() {
  if (uploadTextRef) return uploadTextRef;
  try {
    const mod = await import("./r2-client.js");
    uploadTextRef = mod.uploadText;
  } catch {
    uploadTextRef = null;
  }
  return uploadTextRef;
}

function severityLogger(severity) {
  if (severity === "critical" || severity === "high") return logError;
  if (severity === "medium") return warn;
  return info;
}

let counter = 0;
function nextEventId(source) {
  counter = (counter + 1) % 1_000_000;
  return `qa-${source}-${Date.now()}-${counter}`;
}

/**
 * Emit a structured QA/optimisation event.
 *
 * @param {object} input
 * @param {string} input.source - Which subsystem raised the event, e.g.
 *   "scheduler.dedupe", "validator.anti-hype", "podcast.artwork".
 * @param {string} input.type - Short event type, e.g. "duplicate_blocked".
 * @param {"info"|"low"|"medium"|"high"|"critical"} [input.severity]
 * @param {string} [input.message] - Human-readable summary.
 * @param {object} [input.detail] - Structured payload (defects, evidence, etc).
 * @param {boolean} [input.persist] - Best-effort persist to the QA queue in R2.
 */
export function emitQaEvent({
  source,
  type,
  severity = "info",
  message = "",
  detail = {},
  persist = false,
} = {}) {
  if (!THRESHOLDS.logging.qaEventsEnabled) return null;

  const event = {
    id: nextEventId(source || "qa"),
    ts: new Date().toISOString(),
    source: source || "unknown",
    type: type || "event",
    severity,
    message,
    detail,
  };

  const logFn = severityLogger(severity);
  logFn("qa.event", event);

  if (persist) {
    // Fire-and-forget; never let QA logging break the calling pipeline.
    persistQaEvent(event).catch(() => {});
  }

  if ((severity === "critical" || severity === "high") && THRESHOLDS.logging.alertWebhookUrl) {
    sendQaAlert(event).catch(() => {});
  }

  return event;
}

async function persistQaEvent(event) {
  const uploadText = await getUploadText();
  if (!uploadText) return;
  const day = event.ts.slice(0, 10);
  const key = `qa-events/${day}/${event.id}.json`;
  await uploadText("audits", key, JSON.stringify(event, null, 2), "application/json");
}

async function sendQaAlert(event) {
  try {
    const { fetchWithTimeout } = await import("../http-client.js");
    await fetchWithTimeout(THRESHOLDS.logging.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[QA ${event.severity}] ${event.source}: ${event.message}`, event }),
      timeout: 10_000,
    });
  } catch (err) {
    warn("qa.alert.delivery_failed", { error: err?.message, eventId: event.id });
  }
}

export default { emitQaEvent };
