import { flushStateWrites, readJsonState, readJsonStateFresh, writeJsonState } from "./stateFile.js";
import { warn } from "../../../logger.js";

const STATE_FILE = "professional-excellence.json";
const FAILURE_ALERT_THRESHOLD = Math.max(1, Number(process.env.AIMS_FAILURE_ALERT_THRESHOLD || 3));
const WEBHOOK_TIMEOUT_MS = Math.max(1000, Number(process.env.OPS_ALERT_TIMEOUT_MS || 8000));
const OUTBOX_MAX_ATTEMPTS = 10;
let outboxFlush;

function cleanEnv(name) {
  const value = String(process.env[name] || "").trim();
  return /^\{\{\s*secret\.[^}]+\}\}$/i.test(value) ? "" : value;
}

function emptyState() {
  return {
    version: 1,
    updatedAt: null,
    jobs: {
      queued: 0,
      started: 0,
      completed: 0,
      failed: 0,
      recoveredAfterRetry: 0,
      repeatedFailures: 0,
      failureStreakByType: {},
      lastFailure: null,
      lastSuccess: null,
      pendingOperationalEvents: [],
    },
    providers: {},
  };
}

function loadState() {
  const saved = readJsonState(STATE_FILE, emptyState());
  return {
    ...emptyState(),
    ...saved,
    jobs: { ...emptyState().jobs, ...(saved?.jobs || {}) },
    providers: saved?.providers || {},
  };
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  writeJsonState(STATE_FILE, state);
}

export async function flushOperationalEventOutbox({ now = new Date() } = {}) {
  if (outboxFlush) return outboxFlush;
  outboxFlush = (async () => {
    await flushStateWrites({ throwOnError: true });
    const state = await readJsonStateFresh(STATE_FILE, emptyState());
    const pending = Array.isArray(state?.jobs?.pendingOperationalEvents)
      ? state.jobs.pendingOperationalEvents
      : [];
    if (!pending.length) return { attempted: 0, pending: 0 };
    const retained = [];
    let attempted = 0;
    for (const item of pending) {
      if (item.attempts >= OUTBOX_MAX_ATTEMPTS || new Date(item.nextAttemptAt || 0) > now) {
        retained.push(item);
        continue;
      }
      attempted += 1;
      const result = await sendOperationalEvent(item.event);
      if (result.ok) continue;
      const attempts = item.attempts + 1;
      const delayMs = Math.min(60 * 60 * 1000, 30_000 * (2 ** Math.min(attempts - 1, 7)));
      retained.push({ ...item, attempts, nextAttemptAt: new Date(now.getTime() + delayMs).toISOString() });
    }
    state.jobs.pendingOperationalEvents = retained;
    writeJsonState(STATE_FILE, state);
    await flushStateWrites({ throwOnError: true });
    return { attempted, pending: retained.length };
  })().finally(() => { outboxFlush = undefined; });
  return outboxFlush;
}

export async function sendOperationalEvent(event) {
  const url = cleanEnv("OPS_ALERT_WEBHOOK_URL");
  const token = cleanEnv("OPS_ALERT_WEBHOOK_TOKEN");
  if (!url || !token) return { ok: false, skipped: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        source: "aims_runtime",
        service: "Jonathan-Harris1975/AIMS",
        environment: process.env.NODE_ENV || "unknown",
        occurred_at: new Date().toISOString(),
        ...event,
      }),
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    warn("ops.alert.delivery.fail", { errorName: error?.name || "Error" });
    return { ok: false, error: error?.name || "Error" };
  } finally {
    clearTimeout(timer);
  }
}

export function recordJobTransition(previous, next) {
  if (!next || previous?.status === next.status && previous?.attempt === next.attempt) return;
  const state = loadState();
  const type = String(next.type || "unknown");
  if (next.status === "queued") state.jobs.queued += 1;
  if (next.status === "running") state.jobs.started += 1;
  if (next.status === "completed") {
    state.jobs.completed += 1;
    if (Number(next.attempt || 0) > 1) state.jobs.recoveredAfterRetry += 1;
    state.jobs.failureStreakByType[type] = 0;
    state.jobs.lastSuccess = { type, sessionId: next.sessionId, at: next.finishedAt || next.updatedAt };
  }
  if (next.status === "failed") {
    state.jobs.failed += 1;
    const streak = Number(state.jobs.failureStreakByType[type] || 0) + 1;
    state.jobs.failureStreakByType[type] = streak;
    state.jobs.lastFailure = {
      type,
      sessionId: next.sessionId,
      at: next.finishedAt || next.updatedAt,
      error: String(next.error?.message || "job failed").slice(0, 300),
      failureStreak: streak,
    };
    const failureEvent = {
      event_id: `aims:${type}:${next.sessionId || next.updatedAt || next.finishedAt || "unknown"}:failed`,
      severity: "critical",
      event_type: "scheduled_workflow_failed",
      status: "failure",
      title: `AIMS workflow ${type} failed`,
      summary: "An AIMS workflow reported a failed operation. No publishing retry is initiated by the monitor.",
      release_id: process.env.KOYEB_GIT_SHA || null,
      details: { type, sessionId: next.sessionId, attempt: next.attempt, failureStreak: streak },
    };
    state.jobs.pendingOperationalEvents = Array.isArray(state.jobs.pendingOperationalEvents)
      ? state.jobs.pendingOperationalEvents
      : [];
    if (!state.jobs.pendingOperationalEvents.some((item) => item.event?.event_id === failureEvent.event_id)) {
      state.jobs.pendingOperationalEvents.push({ event: failureEvent, attempts: 0, nextAttemptAt: new Date().toISOString() });
      state.jobs.pendingOperationalEvents = state.jobs.pendingOperationalEvents.slice(-500);
    }
    if (streak === FAILURE_ALERT_THRESHOLD) {
      state.jobs.repeatedFailures += 1;
    }
  }
  saveState(state);
  if (next.status === "failed") {
    void flushOperationalEventOutbox().catch((err) => warn("ops.alert.outbox.fail", { errorName: err?.name || "Error" }));
  }
}

export function recordProviderOutcome({ routeKey, provider, ok, durationMs, status }) {
  const state = loadState();
  const key = `${routeKey || "unknown"}:${provider || "unknown"}`;
  const current = state.providers[key] || {
    routeKey: routeKey || "unknown",
    provider: provider || "unknown",
    calls: 0,
    successes: 0,
    failures: 0,
    totalLatencyMs: 0,
    maxLatencyMs: 0,
    lastStatus: null,
    lastAt: null,
  };
  current.calls += 1;
  current.successes += ok ? 1 : 0;
  current.failures += ok ? 0 : 1;
  const latency = Math.max(0, Number(durationMs || 0));
  current.totalLatencyMs += latency;
  current.maxLatencyMs = Math.max(current.maxLatencyMs, latency);
  current.lastStatus = status || (ok ? "success" : "failed");
  current.lastAt = new Date().toISOString();
  current.averageLatencyMs = current.calls ? Math.round(current.totalLatencyMs / current.calls) : 0;
  current.failureRate = current.calls ? Number((current.failures / current.calls).toFixed(4)) : 0;
  state.providers[key] = current;
  saveState(state);
}

export function getOperationalExcellenceSnapshot() {
  const state = loadState();
  return {
    ...state,
    service: "AIMS",
    releaseId: process.env.APP_VERSION || process.env.npm_package_version || null,
    failureAlertThreshold: FAILURE_ALERT_THRESHOLD,
    alertsConfigured: Boolean(cleanEnv("OPS_ALERT_WEBHOOK_URL") && cleanEnv("OPS_ALERT_WEBHOOK_TOKEN")),
  };
}
