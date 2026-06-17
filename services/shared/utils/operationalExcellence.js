import { readJsonState, writeJsonState } from "./stateFile.js";
import { warn } from "../../../logger.js";

const STATE_FILE = "professional-excellence.json";
const FAILURE_ALERT_THRESHOLD = Math.max(1, Number(process.env.AIMS_FAILURE_ALERT_THRESHOLD || 3));
const WEBHOOK_TIMEOUT_MS = Math.max(1000, Number(process.env.OPS_ALERT_TIMEOUT_MS || 8000));

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
        service: "AIMS",
        environment: process.env.NODE_ENV || "production",
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
    if (streak === FAILURE_ALERT_THRESHOLD) {
      state.jobs.repeatedFailures += 1;
      void sendOperationalEvent({
        event_id: `aims:${type}:${next.sessionId}:failure-threshold`,
        severity: "critical",
        event_type: "repeated_workflow_failure",
        title: `AIMS workflow ${type} failed repeatedly`,
        summary: `The workflow reached ${FAILURE_ALERT_THRESHOLD} consecutive failures.`,
        release_id: process.env.APP_VERSION || process.env.npm_package_version || null,
        details: { type, sessionId: next.sessionId, failureStreak: streak },
      });
    }
  }
  saveState(state);
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
