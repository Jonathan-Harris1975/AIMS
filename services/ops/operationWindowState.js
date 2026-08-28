import { flushStateWrites, readJsonStateFresh, writeJsonState } from "../shared/utils/stateFile.js";

const STATE_FILE = "operation-window-state.json";
const MAX_RECEIPTS = 90;
const TERMINAL_STATUSES = new Set(["completed", "completed-with-failures", "failed"]);

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

export async function getOperationWindowReceipt(id) {
  const state = cleanState(await readJsonStateFresh(STATE_FILE, { receipts: [] }));
  return publicReceipt(state.receipts.find((item) => item.id === normalise(id)) || null);
}

export async function claimOperationWindow({ id, window, executionId, force = false } = {}) {
  const cleanId = normalise(id);
  if (!cleanId) throw new Error("operation window id is required");

  const state = cleanState(await readJsonStateFresh(STATE_FILE, { receipts: [] }));
  const existing = state.receipts.find((item) => item.id === cleanId) || null;
  if (existing && !force) {
    return {
      claimed: false,
      duplicatePrevented: true,
      reason: TERMINAL_STATUSES.has(existing.status)
        ? "same-day-window-already-executed"
        : "same-day-window-already-running",
      receipt: publicReceipt(existing),
    };
  }

  const timestamp = new Date().toISOString();
  const receipt = {
    id: cleanId,
    window: normalise(window),
    executionId: normalise(executionId),
    status: "accepted",
    startedAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
    currentTask: null,
    delayMs: 0,
    results: [],
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
    window: normalise(job.window || existing.window),
    status: normalise(job.status || existing.status || "accepted"),
    startedAt: job.startedAt || existing.startedAt || new Date().toISOString(),
    updatedAt: job.updatedAt || new Date().toISOString(),
    finishedAt: job.finishedAt || null,
    currentTask: job.currentTask || null,
    delayMs: Number(job.delayMs || 0),
    results: Array.isArray(job.results) ? job.results : (existing.results || []),
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
