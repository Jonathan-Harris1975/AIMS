import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadCommsHubConfig } from "../services/comms-hub/config.js";
import { recoverCommsHubSchema } from "../services/comms-hub/migrations/schemaRecovery.js";
import { runCommsHubMigrations } from "../services/comms-hub/migrations/runner.js";

function baseEnv() {
  return {
    COMMS_HUB_ENABLED: "true",
    D1_UUID: "database-id",
    D1_API_KEY: "d1-token",
    JOTFORM_API_KEY: "jotform-token",
    R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "r2-access",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET_COMMS_HUB: "comms-hub",
  };
}

test("Comms Hub automatic schema migration defaults on and can be explicitly disabled", () => {
  assert.equal(loadCommsHubConfig(baseEnv(), { requireEnabled: true }).autoMigrateOnStart, true);
  assert.equal(loadCommsHubConfig({ ...baseEnv(), COMMS_HUB_AUTO_MIGRATE_ON_START: "false" }, { requireEnabled: true }).autoMigrateOnStart, false);
});

test("schema recovery applies pending migrations and verifies the schema afterwards", async () => {
  let checks = 0;
  let migrationCalls = 0;
  const starts = [];
  const repository = {
    async schemaStatus() {
      checks += 1;
      return checks === 1
        ? { available: false, missing: ["0006_smart_response_forms"] }
        : { available: true, missing: [] };
    },
  };
  const result = await recoverCommsHubSchema({
    repository,
    autoMigrateOnStart: true,
    env: baseEnv(),
    onMigrationStart: async (schema) => starts.push(schema.missing),
    migrationRunner: async () => {
      migrationCalls += 1;
      return { ok: true, applied: 1, appliedVersions: ["0006_smart_response_forms"] };
    },
  });
  assert.equal(migrationCalls, 1);
  assert.equal(checks, 2);
  assert.deepEqual(starts, [["0006_smart_response_forms"]]);
  assert.equal(result.schema.available, true);
  assert.equal(result.migrated, true);
});

test("schema recovery does not mutate D1 when automatic migration is disabled", async () => {
  let migrationCalls = 0;
  const repository = {
    async schemaStatus() {
      return { available: false, missing: ["0006_smart_response_forms"] };
    },
  };
  const result = await recoverCommsHubSchema({
    repository,
    autoMigrateOnStart: false,
    migrationRunner: async () => {
      migrationCalls += 1;
      return { ok: true, applied: 1 };
    },
  });
  assert.equal(migrationCalls, 0);
  assert.equal(result.schema.available, false);
});

test("schema recovery fail-closes with a stable error code when migration cannot complete", async () => {
  const repository = {
    async schemaStatus() {
      return { available: false, missing: ["0007_business_hours_and_handoff"] };
    },
  };
  await assert.rejects(
    () => recoverCommsHubSchema({
      repository,
      autoMigrateOnStart: true,
      migrationRunner: async () => { throw new Error("provider unavailable"); },
    }),
    (error) => error.code === "comms_hub_auto_migration_failed" && error.cause?.message === "provider unavailable"
  );
});

test("runtime waits for schema recovery before worker startup", () => {
  const source = readFileSync(new URL("../services/comms-hub/runtime.js", import.meta.url), "utf8");
  const recoveryCall = source.indexOf("recoverCommsHubSchema({");
  const workerStart = source.indexOf("active.archiveWorker.start()", recoveryCall);
  assert.ok(recoveryCall >= 0, "runtime must invoke schema recovery");
  assert.ok(workerStart > recoveryCall, "workers must not start until schema recovery has completed");
});

test("migration runner can apply the full required manifest through a serialised administrative D1 adapter", async () => {
  let migrationBatches = 0;
  const fakeD1 = {
    async query(sql, params = []) {
      const text = String(sql);
      if (/SELECT version, checksum, applied_at FROM comms_hub_schema_migrations/i.test(text)) {
        return { success: true, results: [] };
      }
      if (/UPDATE comms_hub_schema_migration_lock/i.test(text)) {
        return { success: true, results: [{ owner: params[2] }] };
      }
      return { success: true, results: [] };
    },
    async batch(statements) {
      if (/comms_hub_schema_migration_lock/i.test(String(statements[0]?.sql || ""))) {
        return [
          { success: true, results: [] },
          { success: true, results: [{ owner: statements[0].params[0] }] },
        ];
      }
      migrationBatches += 1;
      return statements.map(() => ({ success: true, results: [] }));
    },
  };
  const result = await runCommsHubMigrations({ env: baseEnv(), d1: fakeD1 });
  assert.equal(result.ok, true);
  assert.equal(result.applied, 8);
  assert.equal(result.total, 8);
  assert.equal(migrationBatches, 8);
  assert.deepEqual(result.appliedVersions, [
    "0001_comms_hub",
    "0002_zernio_social",
    "0003_ai_workflows",
    "0004_hardening",
    "0005_operations_and_channels",
    "0006_smart_response_forms",
    "0007_business_hours_and_handoff",
    "0008_full_channel_activation",
  ]);
});

test("migration runner bypasses runtime proxy, serialises writers and preserves checksum immutability", () => {
  const source = readFileSync(new URL("../services/comms-hub/migrations/runner.js", import.meta.url), "utf8");
  assert.match(source, /COMMS_HUB_D1_PROXY_URL:\s*""/);
  assert.match(source, /comms_hub_schema_migration_lock/);
  assert.match(source, /Lost the Comms Hub migration lock/);
  assert.match(source, /Migration checksum mismatch/);
  assert.match(source, /Re-read after acquiring the lock/);
});
