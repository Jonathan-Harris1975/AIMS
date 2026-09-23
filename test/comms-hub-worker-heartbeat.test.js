import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../services/comms-hub/migrations/manifest.js";
import { CommsOperationsRepository } from "../services/comms-hub/repositories/commsOperationsRepository.js";
import {
  buildWorkerHeartbeatHealth,
  evaluateWorkerHeartbeat,
  workerRunAdvanced,
} from "../services/comms-hub/workerHeartbeatState.js";
import { CommsHubWorkerHeartbeatService } from "../services/comms-hub/workerHeartbeatService.js";

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const migration of COMMS_HUB_REQUIRED_MIGRATIONS) {
      this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}.sql`, import.meta.url), "utf8"));
    }
  }
  query(sql, params = []) {
    return { success: true, results: this.db.prepare(sql).all(...params) };
  }
}

const descriptor = { category: "delayed_actions", key: "default", enabled: true, pollIntervalMs: 60_000 };

test("worker heartbeat classifies fresh, degraded, stale, missing and disabled states", () => {
  const now = new Date("2026-09-20T12:10:00.000Z");
  const fresh = evaluateWorkerHeartbeat({ descriptor, rows: [{ instance_id: "a", last_success_at: "2026-09-20T12:09:00.000Z" }], now });
  assert.equal(fresh.status, "healthy");
  assert.equal(fresh.freshness, "fresh");

  const degraded = evaluateWorkerHeartbeat({ descriptor, rows: [{ instance_id: "a", last_success_at: "2026-09-20T12:07:30.000Z" }], now });
  assert.equal(degraded.status, "degraded");

  const stale = evaluateWorkerHeartbeat({ descriptor, rows: [{ instance_id: "a", last_success_at: "2026-09-20T12:05:00.000Z" }], now });
  assert.equal(stale.status, "stale");
  assert.equal(stale.freshness, "stale");

  const missing = evaluateWorkerHeartbeat({ descriptor, rows: [], now });
  assert.equal(missing.status, "stale");
  assert.equal(missing.freshness, "missing");

  const disabled = evaluateWorkerHeartbeat({ descriptor: { ...descriptor, enabled: false }, rows: [], now });
  assert.equal(disabled.status, "disabled");
});

test("durable heartbeat aggregation survives restart rows and recognises multiple instances", async () => {
  const repository = new CommsOperationsRepository(new SqliteD1());
  await repository.recordWorkerHeartbeat({
    category: "delayed_actions", key: "default", instanceId: "old-instance", enabled: true,
    pollIntervalMs: 60_000, event: "success", at: "2026-09-20T12:08:30.000Z",
  });
  await repository.recordWorkerHeartbeat({
    category: "delayed_actions", key: "default", instanceId: "new-instance", enabled: true,
    pollIntervalMs: 60_000, event: "success", at: "2026-09-20T12:09:30.000Z",
  });
  const rows = await repository.listWorkerHeartbeats();
  const health = buildWorkerHeartbeatHealth({ descriptors: [descriptor], rows, now: new Date("2026-09-20T12:10:00.000Z") });
  const delayed = health.workers[0];
  assert.equal(delayed.status, "healthy");
  assert.equal(delayed.instancesSeen, 2);
  assert.equal(delayed.lastSuccessAt, "2026-09-20T12:09:30.000Z");
  assert.equal(health.overall, "healthy");
});


test("heartbeat success does not advance for overlapping or stopping worker ticks", () => {
  assert.equal(workerRunAdvanced({ skipped: true, reason: "already_running" }), false);
  assert.equal(workerRunAdvanced({ skipped: true, reason: "stopping" }), false);
  assert.equal(workerRunAdvanced({ skipped: true }), false);
  assert.equal(workerRunAdvanced({ skipped: true, reason: "not_due" }), true);
  assert.equal(workerRunAdvanced({ skipped: true, reason: "outside_business_hours" }), true);
  assert.equal(workerRunAdvanced({ processed: 0 }), true);
});

test("heartbeat coverage includes every critical Comms Hub maintenance worker", () => {
  const context = {
    config: {
      socialPollWorkerEnabled: false, socialPollMs: 60_000,
      followUpWorkerEnabled: false, followUpPollMs: 60_000,
      providerHealthWorkerEnabled: false, providerHealthPollMs: 60_000,
      delayedActionWorkerEnabled: false, delayedActionPollMs: 60_000,
      archiveWorkerEnabled: true, archivePollMs: 60_000,
      zernioWebhookReconcileEnabled: true, zernioWebhookReconcileIntervalMs: 60_000,
      zernioFamilies: { meta: { enabled: true } },
      backupEnabled: true, backupAutomaticEnabled: true, backupIntervalMs: 86_400_000,
      retentionWorkerEnabled: true, retentionPollMs: 86_400_000,
      monthEndArchiveEnabled: true, monthEndArchivePollMs: 21_600_000,
      housekeepingEnabled: true, housekeepingWorkerEnabled: true, housekeepingPollMs: 86_400_000,
      emailAccounts: {},
    },
  };
  const categories = new Set(new CommsHubWorkerHeartbeatService({ context }).criticalDescriptors().map((item) => item.category));
  for (const category of ["archive", "webhook_reconcile", "backup", "retention", "month_end_archive", "housekeeping"]) {
    assert.equal(categories.has(category), true, `${category} must be monitored`);
  }
});
