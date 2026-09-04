import { flushStateWrites, readJsonStateFresh, writeJsonState } from "../shared/utils/stateFile.js";

const STATE_FILE = "operation-window-state.json";
const MAX_RECEIPTS = 90;
const TERMINAL_STATUSES = new Set(["completed", "completed-with-failures", "failed"]);
const RECOVERABLE_STATUSES = new Set(["completed-with-failures", "failed"]);
const ACTIVE_STATUSES = new Set(["accepted", "running"]);

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
  return Boolean(
    result?.ok
    && result?.result?.ok !== false
    && result?.result?.ready !== false
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
  if (RECOVERABLE_STATUSES.has(receipt?.status)) return true;
  if (receipt?.status === "completed" && Number(receipt?.failures || 0) > 0) return true;
  if (!ACTIVE_STATUSES.has(receipt?.status)) return false;

  const staleMs = Math.max(0, Number(staleAfterMs || 0));
  if (!staleMs) return false;
  const lastHeartbeatMs = Date.parse(receipt.updatedAt || receipt.startedAt || "");
  return Number.isFinite(lastHeartbeatMs) && lastHeartbeatMs + staleMs <= Number(nowMs);
}

export function evaluateOperationWindowClaim(existing, {
  force = false,
  allowRecovery = false,
  maxAttempts = 3,
  recoveryCooldownMs = 60_000,
  staleAfterMs = 0,
  nowMs = Date.now(),
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

  if (!operationWindowNeedsRecovery(existing, { staleAfterMs, nowMs })) {
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
  if (currentAttempt >= attemptLimit) {
    return {
      claimable: false,
      reason: "same-day-window-recovery-exhausted",
      attempt: currentAttempt,
    };
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
