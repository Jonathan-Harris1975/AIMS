import test from "node:test";
import assert from "node:assert/strict";
import { checkKoyebServices } from "../services/ops/koyebMonitor.js";

const SHA = "a".repeat(40);

function response(services) {
  return { ok: true, json: async () => ({ services, has_next: false }) };
}

function harness(serviceList, { prior = { version: 1, services: {} }, delivery = { ok: true }, configuredService = "aims-service-id", runtimeSha = "", at = "2026-11-05T12:00:00.000Z" } = {}) {
  const sent = [];
  let saved;
  const result = checkKoyebServices({
    token: "test-token",
    configuredService,
    runtimeSha,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.authorization, "Bearer test-token");
      if (url.startsWith("https://app.koyeb.com/v1/apps/")) return { ok: true, json: async () => ({ app: { name: "prod" } }) };
      assert.match(url, /^https:\/\/app\.koyeb\.com\/v1\/services\?limit=100&offset=0$/);
      return response(serviceList);
    },
    readState: async () => prior,
    writeState: (_filename, value) => { saved = value; return true; },
    flushWrites: async () => ({ ok: true }),
    sendEvent: async (event) => { sent.push(event); return delivery; },
    now: () => new Date(at),
  });
  return { result, sent, get saved() { return saved; } };
}

test("monitors the service inventory and reports AIMS failures with the exact runtime revision", async () => {
  const run = harness([
    { id: "aims-service-id", name: "aims", status: "UNHEALTHY", active_deployment_id: "deployment-1", deployment: { git: { sha: SHA } } },
    { id: "other-service-id", name: "other", status: "HEALTHY" },
  ]);
  const result = await run.result;
  assert.equal(result.service_count, 2);
  assert.equal(run.sent.length, 1);
  assert.equal(run.sent[0].source, "koyeb");
  assert.equal(run.sent[0].service, "Jonathan-Harris1975/AIMS");
  assert.equal(run.sent[0].release_id, SHA);
  assert.equal(run.sent[0].status, "failure");
  assert.equal(run.sent[0].details.service_id, "aims-service-id");
  assert.equal(run.saved.services["aims-service-id"].status, "unhealthy");
});

test("identifies the running AIMS service by a unique exact deployed revision when KOYEB_SERVICE is unset", async () => {
  const run = harness([
    { id: "aims-service-id", name: "aims", status: "UNHEALTHY", deployment: { git: { sha: SHA } } },
    { id: "other-service-id", name: "other", status: "HEALTHY", deployment: { git: { sha: "b".repeat(40) } } },
  ], { configuredService: "", runtimeSha: SHA });
  await run.result;
  assert.equal(run.sent[0].service, "Jonathan-Harris1975/AIMS");
  assert.equal(run.sent[0].release_id, SHA);
});

test("matches an app-qualified KOYEB_SERVICE selector", async () => {
  const run = harness([
    { id: "aims-service-id", name: "aims", app_id: "prod-app-id", status: "UNHEALTHY", deployment: { git: { sha: SHA } } },
  ], { configuredService: "prod/aims" });
  await run.result;
  assert.equal(run.sent[0].service, "Jonathan-Harris1975/AIMS");
  assert.equal(run.sent[0].release_id, SHA);
});

test("does not associate unrelated account services with the AIMS repository", async () => {
  const run = harness([{ id: "other-service-id", name: "other", status: "DEGRADED" }]);
  await run.result;
  assert.equal(run.sent[0].service, "Koyeb");
  assert.equal(run.sent[0].release_id, null);
});

test("does not resend an unchanged failure after durable state has recorded it", async () => {
  const prior = { version: 2, services: { "aims-service-id": { status: "unhealthy", revision: SHA, activeIncidentId: "koyeb:aims-service-id:failure:old" } } };
  const run = harness([{ id: "aims-service-id", name: "aims", status: "UNHEALTHY", deployment: { git: { sha: SHA } } }], { prior });
  await run.result;
  assert.equal(run.sent.length, 0);
});

test("keeps a failed alert delivery eligible for retry on the next poll", async () => {
  const run = harness([{ id: "aims-service-id", name: "aims", status: "UNHEALTHY" }], { delivery: { ok: false } });
  await run.result;
  assert.equal(run.saved.services["aims-service-id"].status, "unhealthy");
  assert.equal(run.saved.pendingEvents.length, 1);
});

test("retries an undelivered failure after the service recovers and only confirms explicit healthy status", async () => {
  const first = harness([{ id: "aims-service-id", name: "aims", status: "UNHEALTHY" }], { delivery: { ok: false } });
  await first.result;
  const second = harness([{ id: "aims-service-id", name: "aims", status: "STARTING" }], { prior: first.saved });
  await second.result;
  assert.equal(second.sent.length, 1);
  assert.equal(second.sent[0].event_type, "koyeb_service_unhealthy");
  assert.equal(second.saved.services["aims-service-id"].activeIncidentId, first.saved.services["aims-service-id"].activeIncidentId);
  assert.equal(second.saved.pendingEvents.length, 0);

  const third = harness([{ id: "aims-service-id", name: "aims", status: "HEALTHY" }], { prior: second.saved, at: "2026-11-05T12:02:00.000Z" });
  await third.result;
  assert.equal(third.sent[0].event_type, "koyeb_service_recovered");
  assert.equal(third.saved.services["aims-service-id"].activeIncidentId, null);
});

test("assigns a new durable incident identity to a repeated failure after recovery", async () => {
  const prior = { version: 2, services: { "aims-service-id": { status: "healthy", revision: SHA, activeIncidentId: null } } };
  const run = harness([{ id: "aims-service-id", name: "aims", status: "UNHEALTHY", deployment: { git: { sha: SHA } } }], { prior, at: "2026-11-05T12:03:00.000Z" });
  await run.result;
  assert.equal(run.sent[0].event_id, "koyeb:aims-service-id:failure:2026-11-05T12:03:00.000Z");
});

test("skips cleanly when the existing Koyeb token is unavailable", async () => {
  const result = await checkKoyebServices({ token: "", fetchImpl: async () => assert.fail("must not call Koyeb") });
  assert.deepEqual(result, { ok: false, skipped: true, reason: "koyeb_token_missing" });
});
