import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

process.env.APP_TMP_DIR = `/tmp/aims-excellence-${process.pid}-${randomUUID()}`;
process.env.ALLOW_EPHEMERAL_STATE = "true";
process.env.STATE_BACKEND = "local";
process.env.OPS_ALERT_WEBHOOK_URL = "https://hive.example.test/ops/events";
process.env.OPS_ALERT_WEBHOOK_TOKEN = "test-only-token";
process.env.NODE_ENV = "production";
process.env.KOYEB_GIT_SHA = "a".repeat(40);

const { recordJobTransition, recordProviderOutcome, getOperationalExcellenceSnapshot, flushOperationalEventOutbox } = await import("../services/shared/utils/operationalExcellence.js");

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

test("failed AIMS scheduled operations emit a canonical, exact-revision HIVE signal", async () => {
  const originalFetch = globalThis.fetch;
  let resolveRequest;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  globalThis.fetch = async (url, options) => {
    resolveRequest({ url, options, payload: JSON.parse(options.body) });
    return { ok: true, status: 202 };
  };
  try {
    recordJobTransition(null, {
      type: "daily_blog_artwork",
      sessionId: "failed-session-1",
      attempt: 1,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: { message: "provider detail should not be forwarded" },
    });
    const sent = await request;
    assert.equal(sent.url, "https://hive.example.test/ops/events");
    assert.equal(sent.payload.source, "aims_runtime");
    assert.equal(sent.payload.service, "Jonathan-Harris1975/AIMS");
    assert.equal(sent.payload.environment, "production");
    assert.equal(sent.payload.status, "failure");
    assert.equal(sent.payload.release_id, "a".repeat(40));
    assert.equal(sent.payload.event_type, "scheduled_workflow_failed");
    assert.equal(JSON.stringify(sent.payload).includes("provider detail should not be forwarded"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed HIVE delivery stays in the durable outbox and is retried with the same event identity", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: requests.length > 1, status: requests.length > 1 ? 202 : 503 };
  };
  try {
    recordJobTransition(null, {
      type: "daily_blog_artwork_retry",
      sessionId: "failed-session-retry",
      attempt: 1,
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    for (let attempt = 0; attempt < 20 && requests.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(requests.length, 1);
    await flushOperationalEventOutbox({ now: new Date(Date.now() + 120_000) });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].event_id, requests[1].event_id);
    assert.equal(getOperationalExcellenceSnapshot().jobs.pendingOperationalEvents.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
