import assert from "node:assert/strict";
import test from "node:test";

process.env.APP_TMP_DIR = `/tmp/aims-excellence-${process.pid}`;
process.env.ALLOW_EPHEMERAL_STATE = "true";
process.env.STATE_BACKEND = "local";

const { recordJobTransition, recordProviderOutcome, getOperationalExcellenceSnapshot } = await import("../services/shared/utils/operationalExcellence.js");

test("professional excellence metrics record recovery and provider outcomes", () => {
  const base = { type: "audit", sessionId: "session-1", attempt: 2, updatedAt: new Date().toISOString() };
  recordJobTransition({ ...base, status: "running" }, { ...base, status: "completed", finishedAt: new Date().toISOString() });
  recordProviderOutcome({ routeKey: "audit", provider: "primary", ok: true, durationMs: 125 });
  recordProviderOutcome({ routeKey: "audit", provider: "primary", ok: false, durationMs: 75, status: 503 });
  const snapshot = getOperationalExcellenceSnapshot();
  assert.equal(snapshot.jobs.recoveredAfterRetry >= 1, true);
  assert.equal(snapshot.providers["audit:primary"].calls, 2);
  assert.equal(snapshot.providers["audit:primary"].failureRate, 0.5);
  assert.equal(snapshot.providers["audit:primary"].averageLatencyMs, 100);
});
