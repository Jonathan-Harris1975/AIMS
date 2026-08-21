import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getCommsHubReadiness } from "../services/comms-hub/config.js";
import { CommsAiRepository } from "../services/comms-hub/repositories/commsAiRepository.js";
import { CommsHubBackupService } from "../services/comms-hub/backupService.js";
import { CommsHubProviderHealthService } from "../services/comms-hub/providerHealthService.js";
import { CloudflareBackupClient } from "../services/comms-hub/clients/cloudflareBackupClient.js";

const REQUIRED_TABLES = [
  "comms_hub_conversations",
  "comms_hub_messages",
  "comms_hub_ai_runs",
  "comms_hub_reply_drafts",
  "comms_hub_approvals",
  "comms_hub_backup_runs",
];

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const name of ["0001_comms_hub.sql", "0002_zernio_social.sql", "0003_ai_workflows.sql", "0004_hardening.sql"]) {
      this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${name}`, import.meta.url), "utf8"));
    }
  }
  async query(sql, params = []) { return { success: true, results: this.db.prepare(sql).all(...params) }; }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map(({ sql, params = [] }) => ({ success: true, results: this.db.prepare(sql).all(...params) }));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function baseEnv() {
  return {
    COMMS_HUB_ENABLED: "true",
    D1_UUID: "11111111-1111-1111-1111-111111111111",
    D1_API_KEY: "d1-token",
    JOTFORM_API_KEY: "jotform-token",
    R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "r2-key",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET_COMMS_HUB: "comms-hub",
    R2_PUBLIC_BASE_URL_COMMS_HUB: "https://receipts.example.com",
  };
}

class MemoryPrivateR2 {
  constructor(initial = {}) {
    this.objects = new Map(Object.entries(initial).map(([key, value]) => [key, Buffer.from(value)]));
  }
  async putBuffer(key, value) {
    const buffer = Buffer.from(value);
    this.objects.set(key, buffer);
    return { key, size: buffer.length };
  }
  async putText(key, value) { return this.putBuffer(key, Buffer.from(value, "utf8")); }
  async getBuffer(key) {
    if (!this.objects.has(key)) throw new Error(`Object not found: ${key}`);
    return Buffer.from(this.objects.get(key));
  }
  async list(prefix = "") {
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, size: value.length, etag: createHash("md5").update(value).digest("hex") }));
  }
}

function backupContext({ restoredCountDelta = 0, sourceObjects, restoreExistingTables = [] } = {}) {
  const d1 = new SqliteD1();
  const sourceR2 = new MemoryPrivateR2(sourceObjects || {
    "attachments/source.pdf": "private attachment bytes",
    "conversation-assets/diagram.png": "private image bytes",
  });
  const backupR2 = new MemoryPrivateR2();
  const restoreR2 = new MemoryPrivateR2();
  const imported = [];
  const counts = Object.fromEntries(REQUIRED_TABLES.map((name, index) => [name, index + 1]));
  const sourceDatabaseId = "11111111-1111-1111-1111-111111111111";
  const restoreDatabaseId = "22222222-2222-2222-2222-222222222222";
  const context = {
    config: {
      backupEnabled: true,
      d1DatabaseId: sourceDatabaseId,
      restoreDatabaseId,
      backupObjectPrefixes: ["attachments/", "conversation-assets/"],
      backupMaxLinkedObjects: 100,
      r2BucketName: "comms-hub",
      r2PrivateBucketName: "comms-hub-private",
      r2RestoreBucketName: "comms-hub-restore",
    },
    aiRepository: new CommsAiRepository(d1),
    sourceR2,
    backupR2,
    restoreR2,
    backupClient: {
      async ensureRestoreDatabase() {
        return { id: restoreDatabaseId, name: "COMMS_HUB_RESTORE_DATABASE", created: false, source: "test" };
      },
      async exportDatabase() {
        return { sql: Buffer.from("CREATE TABLE restored_marker(id TEXT);"), bookmark: "bookmark-1", filename: "comms-hub.sql" };
      },
      async importDatabase(sql, target) {
        imported.push({ sql: Buffer.from(sql), target });
        return { result: { num_queries: 42 } };
      },
      async queryDatabase(databaseId, sql) {
        if (/NOT GLOB/i.test(sql)) return databaseId === restoreDatabaseId ? restoreExistingTables.map((name) => ({ name })) : [];
        if (/sqlite_schema/i.test(sql)) return REQUIRED_TABLES.map((name) => ({ name }));
        const match = sql.match(/FROM\s+"([^"]+)"/i);
        if (!match) throw new Error(`Unexpected query: ${sql}`);
        const delta = databaseId === restoreDatabaseId && match[1] === REQUIRED_TABLES[0] ? restoredCountDelta : 0;
        return [{ count: counts[match[1]] + delta }];
      },
    },
  };
  return { d1, sourceR2, backupR2, restoreR2, imported, counts, context };
}

test("Phase 4 backup readiness is opt-in and requires private R2 storage", () => {
  const disabled = getCommsHubReadiness(baseEnv());
  assert.equal(disabled.ready, true);
  const missing = getCommsHubReadiness({ ...baseEnv(), COMMS_HUB_BACKUP_ENABLED: "true" });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missing, [
    "R2_BUCKET_COMMS_HUB_PRIVATE",
    "R2_BUCKET_COMMS_HUB_RESTORE",
  ]);
  const enabled = getCommsHubReadiness({
    ...baseEnv(),
    COMMS_HUB_BACKUP_ENABLED: "true",
    R2_BUCKET_COMMS_HUB_PRIVATE: "comms-hub-private",
    R2_BUCKET_COMMS_HUB_RESTORE: "comms-hub-restore",
    COMMS_HUB_RESTORE_DATABASE_ID: "22222222-2222-2222-2222-222222222222",
  });
  assert.equal(enabled.ready, true);
});

test("Automatic backups and Cloudflare account routing fail closed when their prerequisites are missing", () => {
  const automatic = getCommsHubReadiness({
    ...baseEnv(),
    COMMS_HUB_BACKUP_AUTOMATIC_ENABLED: "true",
  });
  assert.equal(automatic.ready, false);
  assert.deepEqual(automatic.missing, ["COMMS_HUB_BACKUP_ENABLED"]);

  const missingAccount = getCommsHubReadiness({
    ...baseEnv(),
    R2_ENDPOINT: "https://r2.example.invalid",
    COMMS_HUB_BACKUP_ENABLED: "true",
    R2_BUCKET_COMMS_HUB_PRIVATE: "comms-hub-private",
    R2_BUCKET_COMMS_HUB_RESTORE: "comms-hub-restore",
    COMMS_HUB_RESTORE_DATABASE_ID: "22222222-2222-2222-2222-222222222222",
  });
  assert.equal(missingAccount.ready, false);
  assert.deepEqual(missingAccount.missing, ["CLOUDFLARE_ACCOUNT_ID"]);
});

test("Provider health records rate limiting, outages and unknown configuration without inventing liveness", async () => {
  const d1 = new SqliteD1();
  const now = new Date().toISOString();
  const context = {
    config: {
      providerHealthStaleMs: 900_000,
      providerHealthFailureThreshold: 3,
      aiEnabled: false,
      zernioFamilies: { meta: { enabled: true }, video: { enabled: false } },
    },
    aiRepository: new CommsAiRepository(d1),
  };
  const service = new CommsHubProviderHealthService({
    context,
    snapshotProvider: () => ({
      releaseId: "release-test",
      providers: {
        rate: { routeKey: "comms-hub:zernio-meta-live", provider: "zernio-meta", calls: 10, successes: 7, failures: 3, failureRate: 0.3, lastStatus: "429", lastAt: now },
        down: { routeKey: "comms-hub:ai-live", provider: "openrouter", calls: 5, successes: 0, failures: 5, failureRate: 1, lastStatus: "500", lastAt: now },
      },
    }),
  });
  const captured = await service.capture();
  assert.equal(captured.find((item) => item.adapter === "comms-hub:zernio-meta-live")?.status, "rate_limited");
  assert.equal(captured.find((item) => item.adapter === "comms-hub:ai-live")?.status, "unavailable");
  assert.equal(captured.find((item) => item.adapter === "comms-hub:storage")?.status, "unknown");
  const status = await service.status();
  assert.equal(status.overall, "unavailable");
});

test("Provider health prefers real observations over readiness placeholders for the same provider route", async () => {
  const d1 = new SqliteD1();
  const now = new Date().toISOString();
  const context = {
    config: {
      providerHealthStaleMs: 900_000,
      providerHealthFailureThreshold: 3,
      aiEnabled: false,
      zernioFamilies: { meta: { enabled: true }, video: { enabled: false } },
    },
    aiRepository: new CommsAiRepository(d1),
  };
  const service = new CommsHubProviderHealthService({
    context,
    snapshotProvider: () => ({
      providers: {
        live: {
          routeKey: "comms-hub:zernio-meta",
          provider: "zernio-meta",
          calls: 4,
          successes: 4,
          failures: 0,
          failureRate: 0,
          lastStatus: "success",
          lastAt: now,
        },
      },
    }),
  });
  const captured = await service.capture();
  const matching = captured.filter((item) => item.provider === "zernio-meta" && item.adapter === "comms-hub:zernio-meta");
  assert.equal(matching.length, 1);
  assert.equal(matching[0].status, "healthy");
  assert.equal(matching[0].successCount, 4);
});

test("D1 and private R2 backup archives independent copies with checksums and validates from the archive", async () => {
  const { d1, sourceR2, backupR2, restoreR2, imported, counts, context } = backupContext();
  const service = new CommsHubBackupService({ context });
  const backup = await service.runBackup({ actor: "test-suite" });
  assert.equal(backup.status, "complete");
  assert.equal(backup.linkedObjectCount, 2);

  const rows = d1.db.prepare("SELECT * FROM comms_hub_backup_objects WHERE backup_run_id = ? ORDER BY object_key").all(backup.id);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row.archive_object_key, new RegExp(`^backups/.+/${backup.id}/objects/`));
    assert.equal(backupR2.objects.has(row.archive_object_key), true);
    assert.equal(row.bucket_name, "comms-hub");
    assert.notEqual(row.archive_object_key, row.object_key);
  }

  const manifest = JSON.parse((await backupR2.getBuffer(backup.manifestKey)).toString("utf8"));
  assert.equal(manifest.backupRunId, backup.id);
  assert.equal(manifest.linkedObjects.length, 2);
  assert.ok(manifest.linkedObjects.every((object) => object.sourceKey && object.archiveKey && object.sha256));

  sourceR2.objects.delete("attachments/source.pdf");
  sourceR2.objects.delete("conversation-assets/diagram.png");
  const validated = await service.validateRestore(backup.id, { actor: "restore-test" });
  assert.equal(validated.status, "validated");
  assert.equal(validated.details.linkedObjectsVerified, 2);
  assert.deepEqual(validated.details.recordCounts, counts);
  assert.equal(validated.details.restoreBucket, "comms-hub-restore");
  assert.equal(restoreR2.objects.size, 2);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].target, context.config.restoreDatabaseId);
  const verifiedObjects = d1.db.prepare("SELECT status FROM comms_hub_backup_objects WHERE backup_run_id = ? ORDER BY object_key").all(backup.id);
  assert.deepEqual(verifiedObjects.map((row) => row.status), ["verified", "verified"]);
});

test("Restore validation refuses a non-empty target before importing any data", async () => {
  const { context, imported } = backupContext({ restoreExistingTables: ["old_restore"] });
  const service = new CommsHubBackupService({ context });
  const backup = await service.runBackup();
  await assert.rejects(() => service.validateRestore(backup.id), (error) => error?.code === "restore_target_not_empty");
  assert.equal(imported.length, 0);
  const run = await context.aiRepository.getBackupRun(backup.id);
  assert.equal(run.validation_status, "failed");
});

test("Restore validation fails closed when the archived manifest is altered", async () => {
  const { backupR2, context } = backupContext();
  const service = new CommsHubBackupService({ context });
  const backup = await service.runBackup();
  backupR2.objects.set(backup.manifestKey, Buffer.from("{\"tampered\":true}"));
  await assert.rejects(() => service.validateRestore(backup.id), (error) => error?.code === "backup_manifest_checksum_mismatch");
  const run = await context.aiRepository.getBackupRun(backup.id);
  assert.equal(run.status, "failed");
  assert.equal(run.validation_status, "failed");
});

test("Restore validation fails closed when restored record counts differ", async () => {
  const { context } = backupContext({ restoredCountDelta: 1 });
  const service = new CommsHubBackupService({ context });
  const backup = await service.runBackup();
  await assert.rejects(() => service.validateRestore(backup.id), (error) => error?.code === "restore_record_count_mismatch");
  const run = await context.aiRepository.getBackupRun(backup.id);
  assert.equal(run.validation_status, "failed");
});

test("Backup refuses to silently truncate linked R2 objects", async () => {
  const { context } = backupContext();
  context.config.backupMaxLinkedObjects = 1;
  const service = new CommsHubBackupService({ context });
  await assert.rejects(() => service.runBackup(), (error) => error?.code === "backup_object_limit_exceeded");
  const latest = await context.aiRepository.getLatestBackupStatus();
  assert.equal(latest.runs[0].status, "quarantined");
});

test("AIMS discovers or creates COMMS_HUB_RESTORE_DATABASE without requiring a pre-provisioned UUID", async () => {
  const calls = [];
  const config = {
    cloudflareApiBaseUrl: "https://api.cloudflare.com/client/v4",
    cloudflareAccountId: "account-1",
    d1DatabaseId: "production-db",
    d1ApiToken: "token",
    restoreDatabaseName: "COMMS_HUB_RESTORE_DATABASE",
    restoreDatabaseId: "",
    backupRequestTimeoutMs: 10_000,
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    if (options.method === "GET") {
      return { ok: true, status: 200, json: async () => ({ success: true, result: [] }) };
    }
    if (options.method === "POST" && url.endsWith("/d1/database")) {
      assert.deepEqual(JSON.parse(options.body), { name: "COMMS_HUB_RESTORE_DATABASE" });
      return { ok: true, status: 200, json: async () => ({ success: true, result: { uuid: "restore-db", name: "COMMS_HUB_RESTORE_DATABASE" } }) };
    }
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  };
  const client = new CloudflareBackupClient(config, { fetchImpl });
  const created = await client.ensureRestoreDatabase();
  assert.deepEqual(created, { id: "restore-db", name: "COMMS_HUB_RESTORE_DATABASE", created: true, source: "created" });
  const cached = await client.ensureRestoreDatabase();
  assert.equal(cached.id, "restore-db");
  assert.equal(cached.source, "runtime_cache");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\?name=COMMS_HUB_RESTORE_DATABASE&page=1&per_page=100$/);
});

test("AIMS reuses an existing COMMS_HUB_RESTORE_DATABASE by exact name", async () => {
  const config = {
    cloudflareApiBaseUrl: "https://api.cloudflare.com/client/v4",
    cloudflareAccountId: "account-1",
    d1DatabaseId: "production-db",
    d1ApiToken: "token",
    restoreDatabaseName: "COMMS_HUB_RESTORE_DATABASE",
    restoreDatabaseId: "",
    backupRequestTimeoutMs: 10_000,
  };
  const fetchImpl = async (_url, options) => {
    assert.equal(options.method, "GET");
    return { ok: true, status: 200, json: async () => ({ success: true, result: [{ uuid: "existing-restore-db", name: "COMMS_HUB_RESTORE_DATABASE" }] }) };
  };
  const result = await new CloudflareBackupClient(config, { fetchImpl }).ensureRestoreDatabase();
  assert.deepEqual(result, { id: "existing-restore-db", name: "COMMS_HUB_RESTORE_DATABASE", created: false, source: "discovered_by_name" });
});

test("Cloudflare D1 import uses init, checksum upload and ingest, and refuses the production target", async () => {
  const sql = Buffer.from("CREATE TABLE x(id INTEGER);");
  const expectedEtag = createHash("md5").update(sql).digest("hex");
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body });
    if (url === "https://upload.example.com/d1.sql") {
      return { ok: true, status: 200, headers: new Headers({ etag: expectedEtag }) };
    }
    const body = JSON.parse(options.body);
    if (body.action === "init") {
      return { ok: true, status: 200, json: async () => ({ success: true, result: { upload_url: "https://upload.example.com/d1.sql", filename: "d1.sql" } }) };
    }
    if (body.action === "ingest") {
      return { ok: true, status: 200, json: async () => ({ success: true, result: { status: "complete", result: { num_queries: 1 } } }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const config = {
    cloudflareApiBaseUrl: "https://api.cloudflare.com/client/v4",
    cloudflareAccountId: "account-1",
    d1DatabaseId: "production-db",
    d1ApiToken: "token",
    backupRequestTimeoutMs: 10_000,
    backupPollAttempts: 2,
    backupPollMs: 1,
  };
  const client = new CloudflareBackupClient(config, { fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(() => client.importDatabase(sql, "production-db"), (error) => error?.code === "restore_target_unsafe");
  const result = await client.importDatabase(sql, "restore-db");
  assert.equal(result.status, "complete");
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[0].body), { action: "init", etag: expectedEtag });
  assert.equal(calls[1].method, "PUT");
  assert.deepEqual(JSON.parse(calls[2].body), { action: "ingest", etag: expectedEtag, filename: "d1.sql" });
});
