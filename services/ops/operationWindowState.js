import { flushStateWrites, readJsonStateFresh, writeJsonState } from "../shared/utils/stateFile.js";

const STATE_FILE = "operation-window-state.json";
const MAX_RECEIPTS = 90;
const TERMINAL_STATUSES = new Set(["completed", "completed-with-failures", "failed"]);
const RECOVERABLE_STATUSES = new Set(["completed-with-failures", "failed"]);
const ACTIVE_STATUSES = new Set(["accepted", "running"]);

// A deployment that repairs a failed operation window needs one bounded way
// past an already-exhausted receipt. Bumping this value deliberately grants
// that deployment one recovery attempt; the revision is persisted with the
// new receipt, so normal scheduler polling cannot turn it into a retry loop.
export const OPERATION_RECOVERY_REVISION = "content-upstream-recovery-2026-11-03-v1";
export const PODCAST_RECOVERY_REVISION = "podcast-section-validation-2026-10-30-v2";
// One deployment-scoped recovery for a failed newsletter window after the
// source/artwork continuity repair. Successful sibling tasks remain reusable.
export const NEWSLETTER_RECOVERY_REVISION = "newsletter-source-grounding-weekend-2026-11-13-v3";

function normalise(value = "") {
  return String(value || "").trim();
}

function cleanState(raw = {}) {
  const receipts = Array.isArray(raw?.receipts) ? raw.receipts : [];
  return {
    receipts: receipts
      .filter((item) => item && normalise(item.id))
      .sort((a, b) => String(a.updatedAt || a.startedAt || "").localeCompare(String(b.updatedAt || b.startedAt || "")))
      .slice(-MAX_RECEIPTS),
  };
}

function publicReceipt(receipt) {
  if (!receipt) return null;
  return {
    ...receipt,
    terminal: TERMINAL_STATUSES.has(receipt.status),
  };
}

export function operationTaskSucceeded(result = {}) {
  // A 2xx transport acknowledgement does not prove a content item exists.
  // In particular, "skipped because no source / previous work is still owned"
  // must not satisfy dependencies or be cached as a completed operation task.
  if (!result?.ok || result?.result?.ok === false || result?.result?.ready === false) return false;
  if (result.skipped) return result.reason === "newsletter-disabled-by-configuration";
  // A partially published episode is deliberately NOT safe to replay. Keep
  // its existing provider handoff, preserve the warning for reconciliation,
  // and do not generate a duplicate podcast when the operation resumes.
  if (result.name === "podcast" && result.nonRetryablePartialPublication === true && result.warning === true) return true;

  const payload = result?.asyncJob?.job?.result
    ?? result?.asyncJob?.result
    ?? result?.result;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (payload?.ok === false || payload?.ready === false || payload?.failed === true
      || payload?.partialFailure === true || payload?.quarantined === true) return false;
  const status = String(payload?.status || "").toLowerCase();
  if (["failed", "error", "partial", "pending", "queued", "accepted", "running"].includes(status)
      && result?.asyncStatus !== "completed") return false;
  if (payload?.skipped !== true) {
    if (payload?.ok === true || payload?.ready === true) return true;
    // RSS reports QA statistics, rather than a generic ok flag. The child
    // must have terminated and produced genuine, fully-passed rewritten items.
    // A bare HTTP 202/running acknowledgement never satisfies this contract.
    if (result.name === "rss-rewrite" && result.asyncStatus === "completed") {
      return payload?.phase3Quality?.status === "ALL_PASSED_AUTO_PUBLISH"
        && Number(payload.phase3Quality.passed || 0) > 0
        && Number(payload.phase3Quality.failed || 0) === 0
        && Number(payload.rewrittenItems || 0) > 0;
    }
    return false;
  }

  // A skip is successful only when backed by a confirmed existing artefact
  // or already-completed provider handoff. These are read-only confirmations;
  // ambiguous/unknown skips are recovered, never silently marked delivered.
  return Boolean(
    payload.existing
    || payload.alreadyPublished === true
    || payload.alreadyDispatched === true
    || payload.alreadyScheduled === true
    || (Array.isArray(payload.publicationReferences) && payload.publicationReferences.length > 0)
    || ["already_dispatched", "already_published", "already_scheduled", "already_completed"].includes(status)
  );
}

export function reusableOperationTaskResults(receipt = {}) {
  const candidates = [
    ...(Array.isArray(receipt?.resumeResults) ? receipt.resumeResults : []),
    ...(Array.isArray(receipt?.results) ? receipt.results : []),
  ];
  const byName = new Map();
  for (const result of candidates) {
    const name = normalise(result?.name);
    if (!name || !operationTaskSucceeded(result)) continue;
    byName.set(name, result);
  }
  return [...byName.values()];
}

export function operationWindowNeedsRecovery(receipt = {}, {
  staleAfterMs = 0,
  nowMs = Date.now(),
} = {}) {
  const failures = (receipt.results || []).filter((result) => result?.ok === false);
  if (failures.length && failures.every((result) => result.retryable === false)) return false;
  if (RECOVERABLE_STATUSES.has(receipt?.status)) return true;
  if (receipt?.status === "completed" && Number(receipt?.failures || 0) > 0) return true;
  if (!ACTIVE_STATUSES.has(receipt?.status)) return false;

  const staleMs = Math.max(0, Number(staleAfterMs || 0));
  if (!staleMs) return false;
  const lastHeartbeatMs = Date.parse(receipt.updatedAt || receipt.startedAt || "");
  return Number.isFinite(lastHeartbeatMs) && lastHeartbeatMs + staleMs <= Number(nowMs);
}

// Status reads must release a scheduler waiting on work whose heartbeat died
// during a deployment. Project a retryable failure without changing the durable
// receipt: the next normal POST still owns the claim, budget and deduplication.
export function operationWindowPollStatus(receipt, {
  staleAfterMs = 0,
  nowMs = Date.now(),
  allowRecovery = true,
  maxAttempts = 3,
  recoveryCooldownMs = 60_000,
  recoveryRevision = "",
} = {}) {
  if (!receipt) return receipt;
  const active = ACTIVE_STATUSES.has(receipt.status);
  const needsRecovery = operationWindowNeedsRecovery(receipt, { staleAfterMs, nowMs });
  if (!needsRecovery || (!active && !RECOVERABLE_STATUSES.has(receipt.status))) return receipt;
  const decision = evaluateOperationWindowClaim(receipt, {
    staleAfterMs, nowMs, allowRecovery, maxAttempts, recoveryCooldownMs, recoveryRevision,
  });
  if (!active) {
    if (!decision.claimable) return receipt;
    return { ...receipt, recoveryAvailable: true, retryable: true,
      availableRecoveryRevision: recoveryRevision || null };
  }
  return {
    ...receipt,
    status: "failed",
    previousStatus: receipt.status,
    terminal: true,
    retryable: Boolean(allowRecovery),
    recoveryAvailable: decision.claimable,
    availableRecoveryRevision: decision.claimable ? recoveryRevision || null : null,
    interrupted: true,
    reason: "operation-heartbeat-expired",
    error: "Operation heartbeat expired; the execution was interrupted and must be reclaimed before work can resume.",
    failures: Math.max(1, Number(receipt.failures || 0)),
  };
}

// Reserve one bounded recovery attempt for each late MAST backstop. Without
// this reservation, the original worker can exhaust the whole attempt budget
// before the afternoon or evening continuity checks start. Never grant one
// on a different calendar day, a non-content window, or before the slot opens.
export function sameDayBackstopAllowance(receipt = {}, nowMs = Date.now()) {
  const windowName = normalise(receipt.window || normalise(receipt.id).split(":")[1]);
  const slots = windowName === "friday-pm"
    ? ["18:30", "22:10"]
    : /^(monday|tuesday|wednesday|thursday|friday)-am$/.test(windowName)
      ? ["15:45", "21:20"] : [];
  if (!slots.length || !Number.isFinite(nowMs)) return 0;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(nowMs)).map((part) => [part.type, part.value]));
  if (!parts.year || !parts.month || !parts.day || !/^\d{2}$/.test(parts.hour || "")
      || !/^\d{2}$/.test(parts.minute || "")) return 0;
  const londonDate = `${parts.year}-${parts.month}-${parts.day}`;
  if (!normalise(receipt.id).startsWith(`${londonDate}:`)) return 0;
  const localMinute = Number(parts.hour) * 60 + Number(parts.minute);
  return slots.filter((time) => {
    const [hour, minute] = time.split(":").map(Number);
    return localMinute >= hour * 60 + minute;
  }).length;
}

export function evaluateOperationWindowClaim(existing, {
  force = false,
  allowRecovery = false,
  maxAttempts = 3,
  recoveryCooldownMs = 60_000,
  staleAfterMs = 0,
  nowMs = Date.now(),
  recoveryRevision = "",
} = {}) {
  if (!existing) {
    return { claimable: true, attempt: 1, recovery: false };
  }

  const currentAttempt = Math.max(1, Number(existing.attempt || 1));
  if (force) {
    return {
      claimable: true,
      attempt: currentAttempt + 1,
      recovery: true,
      recoveredFromExecutionId: existing.executionId || null,
    };
  }

  const revision = normalise(recoveryRevision);
  const revisionChanged = Boolean(revision && revision !== normalise(existing.recoveryRevision));
  const failedPodcast = (existing.results || []).some((result) => result?.name === "podcast" && result?.ok === false);
  // A newly deployed, explicit podcast repair may recover a terminal 422 once;
  // the receipt records the revision so repeated scheduler calls cannot loop.
  const podcastRevisionRecovery = allowRecovery && revisionChanged && failedPodcast
    && RECOVERABLE_STATUSES.has(existing.status);
  if (!podcastRevisionRecovery && !operationWindowNeedsRecovery(existing, { staleAfterMs, nowMs })) {
    return {
      claimable: false,
      reason: TERMINAL_STATUSES.has(existing.status)
        ? "same-day-window-already-executed"
        : "same-day-window-already-running",
    };
  }

  if (!allowRecovery) {
    return { claimable: false, reason: "same-day-window-already-executed" };
  }

  const attemptLimit = Math.max(1, Number(maxAttempts || 3));
  const requestedRevision = normalise(recoveryRevision);
  const existingRevision = normalise(existing.recoveryRevision);
  const revisionRecovery = Boolean(requestedRevision && requestedRevision !== existingRevision);
  // Normal attempts are capped by the configured budget. The two scheduled
  // same-day backstop slots each unlock at most one *additional* claim; no
  // high-frequency replays can consume tomorrow's recovery allowance.
  const availableAttempts = attemptLimit + sameDayBackstopAllowance(existing, Number(nowMs));
  if (currentAttempt >= availableAttempts && !revisionRecovery) {
    return {
      claimable: false,
      reason: "same-day-window-recovery-exhausted",
      attempt: currentAttempt,
    };
  }

  const sourceRetryAt = Math.max(0, ...(existing.results || []).filter((result) => result?.ok === false)
    .map((result) => Date.parse(result.nextRetryAt || "") || 0));
  if (sourceRetryAt > Number(nowMs)) {
    return { claimable: false, reason: "same-day-window-recovery-cooldown", retryAt: new Date(sourceRetryAt).toISOString() };
  }

  const lastFinishedAt = Date.parse(existing.finishedAt || existing.updatedAt || existing.startedAt || "");
  const cooldownMs = Math.max(0, Number(recoveryCooldownMs || 0));
  const retryAtMs = Number.isFinite(lastFinishedAt) ? lastFinishedAt + cooldownMs : 0;
  if (retryAtMs > Number(nowMs)) {
    return {
      claimable: false,
      reason: "same-day-window-recovery-cooldown",
      attempt: currentAttempt,
      retryAt: new Date(retryAtMs).toISOString(),
    };
  }

  return {
    claimable: true,
    attempt: currentAttempt + 1,
    recovery: true,
    recoveryRevision: requestedRevision || existingRevision || null,
    revisionRecovery,
    recoveredFromExecutionId: existing.executionId || null,
  };
}

export { classifyOperationDuplicate } from "./operationDuplicate.js";

export async function getOperationWindowReceipt(id) {
  const state = cleanState(await readJsonStateFresh(STATE_FILE, { receipts: [] }));
  return publicReceipt(state.receipts.find((item) => item.id === normalise(id)) || null);
}

export async function claimOperationWindow({
  id,
  window,
  executionId,
  force = false,
  allowRecovery = false,
  maxAttempts = 3,
  recoveryCooldownMs = 60_000,
  staleAfterMs = 0,
  recoveryRevision = "",
} = {}) {
  const cleanId = normalise(id);
  if (!cleanId) throw new Error("operation window id is required");

  const state = cleanState(await readJsonStateFresh(STATE_FILE, { receipts: [] }));
  const existing = state.receipts.find((item) => item.id === cleanId) || null;
  const decision = evaluateOperationWindowClaim(existing, {
    force,
    allowRecovery,
    maxAttempts,
    recoveryCooldownMs,
    staleAfterMs,
    recoveryRevision,
  });
  if (!decision.claimable) {
    return {
      claimed: false,
      duplicatePrevented: true,
      reason: decision.reason,
      retryAt: decision.retryAt || null,
      receipt: publicReceipt(existing),
    };
  }

  const timestamp = new Date().toISOString();
  const receipt = {
    id: cleanId,
    window: normalise(window),
    executionId: normalise(executionId),
    attempt: decision.attempt,
    recovery: Boolean(decision.recovery),
    recoveryRevision: decision.recoveryRevision || normalise(recoveryRevision) || null,
    revisionRecovery: Boolean(decision.revisionRecovery),
    recoveredFromExecutionId: decision.recoveredFromExecutionId || null,
    status: "accepted",
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    currentTask: null,
    delayMs: 0,
    results: [],
    resumeResults: decision.recovery && !force
      ? reusableOperationTaskResults(existing)
      : [],
    failures: 0,
  };

  state.receipts = [
    ...state.receipts.filter((item) => item.id !== cleanId),
    receipt,
  ].slice(-MAX_RECEIPTS);
  writeJsonState(STATE_FILE, state);
  await flushStateWrites({ throwOnError: process.env.NODE_ENV === "production" });

  // Re-read durable state before any provider work starts. If another instance
  // won the same daily window at the same time, only the durable winner proceeds.
  const confirmed = await getOperationWindowReceipt(cleanId);
  if (!confirmed || confirmed.executionId !== receipt.executionId) {
    return {
      claimed: false,
      duplicatePrevented: true,
      reason: "same-day-window-claimed-by-another-instance",
      receipt: confirmed,
    };
  }

  return { claimed: true, duplicatePrevented: false, receipt: publicReceipt(receipt) };
}

export async function persistOperationWindow(job = {}) {
  const id = normalise(job.id);
  if (!id) return null;

  const state = cleanState(await readJsonStateFresh(STATE_FILE, { receipts: [] }));
  const existing = state.receipts.find((item) => item.id === id) || {};
  // Never let a stale execution overwrite a newer forced/recovered execution.
  if (existing.executionId && job.executionId && existing.executionId !== job.executionId) {
    return publicReceipt(existing);
  }

  const receipt = {
    ...existing,
    id,
    executionId: normalise(job.executionId || existing.executionId),
    attempt: Math.max(1, Number(job.attempt || existing.attempt || 1)),
    recovery: Boolean(job.recovery ?? existing.recovery),
    recoveryRevision: normalise(job.recoveryRevision || existing.recoveryRevision) || null,
    revisionRecovery: Boolean(job.revisionRecovery ?? existing.revisionRecovery),
    recoveredFromExecutionId: job.recoveredFromExecutionId || existing.recoveredFromExecutionId || null,
    window: normalise(job.window || existing.window),
    status: normalise(job.status || existing.status || "accepted"),
    startedAt: job.startedAt || existing.startedAt || new Date().toISOString(),
    updatedAt: job.updatedAt || new Date().toISOString(),
    finishedAt: job.finishedAt || null,
    currentTask: job.currentTask || null,
    delayMs: Number(job.delayMs || 0),
    results: Array.isArray(job.results) ? job.results : (existing.results || []),
    resumeResults: Array.isArray(job.resumeResults) ? job.resumeResults : (existing.resumeResults || []),
    failures: Number(job.failures || 0),
  };

  state.receipts = [
    ...state.receipts.filter((item) => item.id !== id),
    receipt,
  ].slice(-MAX_RECEIPTS);
  writeJsonState(STATE_FILE, state);
  await flushStateWrites({ throwOnError: process.env.NODE_ENV === "production" });
  return publicReceipt(receipt);
}
