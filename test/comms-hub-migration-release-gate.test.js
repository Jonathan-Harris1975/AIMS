import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../services/comms-hub/migrations/manifest.js";
import { runCommsHubMigrations } from "../services/comms-hub/migrations/runner.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDir = path.join(repositoryRoot, "services", "comms-hub", "migrations");

function migrationEnv() {
  return {
    COMMS_HUB_ENABLED: "true",
    D1_UUID: "release-gate-database",
    D1_API_KEY: "release-gate-token",
    JOTFORM_API_KEY: "release-gate-jotform",
    R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "release-gate-access",
    R2_SECRET_ACCESS_KEY: "release-gate-secret",
    R2_BUCKET_COMMS_HUB: "release-gate-comms",
    COMMS_HUB_MIGRATION_LOCK_WAIT_MS: "1000",
    COMMS_HUB_MIGRATION_LOCK_POLL_MS: "100",
  };
}

function isRowReturningSql(sql) {
  return /^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
}

class SqliteD1Adapter {
  constructor({ failMigrationVersion = null } = {}) {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.failMigrationVersion = failMigrationVersion;
    this.failedVersions = new Set();
  }

  execute(sql, params = []) {
    const statement = this.db.prepare(sql);
    if (isRowReturningSql(sql)) {
      return { success: true, results: statement.all(...params) };
    }
    const result = statement.run(...params);
    return { success: true, results: [], meta: { changes: Number(result.changes || 0) } };
  }

  async query(sql, params = []) {
    return this.execute(sql, params);
  }

  async batch(statements) {
    if (statements.some(({ sql }) => /^\s*PRAGMA\s+foreign_keys\b/i.test(String(sql || "")))) {
      throw new Error("Cloudflare D1 cannot change PRAGMA foreign_keys inside its implicit transaction");
    }
    const migrationInsert = statements.at(-1);
    const migrationVersion = /INSERT INTO comms_hub_schema_migrations/i.test(String(migrationInsert?.sql || ""))
      ? String(migrationInsert?.params?.[0] || "")
      : "";

    if (
      migrationVersion &&
      migrationVersion === this.failMigrationVersion &&
      !this.failedVersions.has(migrationVersion)
    ) {
      this.failedVersions.add(migrationVersion);
      throw new Error(`Synthetic migration failure for ${migrationVersion}`);
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(({ sql, params = [] }) => this.execute(sql, params));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

function migrationFiles() {
  return readdirSync(migrationDir)
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .sort();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function applyHistoricalSnapshot(adapter, throughVersion) {
  adapter.db.exec(`CREATE TABLE IF NOT EXISTS comms_hub_schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  for (const name of migrationFiles()) {
    const version = name.replace(/\.sql$/i, "");
    const sql = readFileSync(path.join(migrationDir, name), "utf8");
    adapter.db.exec(sql);
    adapter.db.prepare(
      "INSERT INTO comms_hub_schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)"
    ).run(version, sha256(sql), "2026-09-01T00:00:00.000Z");
    if (version === throughVersion) break;
  }
}

function seedExistingCommunications(adapter) {
  const now = "2026-09-01T12:00:00.000Z";
  adapter.db.prepare(
    `INSERT INTO comms_hub_contacts
      (id, primary_email, display_name, phone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("contact-existing", "existing@example.com", "Existing Contact", null, now, now);

  adapter.db.prepare(
    `INSERT INTO comms_hub_conversations
      (id, channel, provider, workflow, status, contact_id, subject, source_reference,
       created_at, updated_at, last_message_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "conversation-existing", "email", "one.com", "inbound", "open", "contact-existing",
    "Existing conversation", "release-gate-existing", now, now, now, "{}"
  );

  adapter.db.prepare(
    `INSERT INTO comms_hub_messages
      (id, conversation_id, direction, sender, recipients_json, subject, body_text, body_html,
       provider_message_id, received_at, created_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "message-existing", "conversation-existing", "inbound", "existing@example.com",
    '["info@example.com"]', "Existing conversation", "Preserve this communication state", null,
    "provider-message-existing", now, now, "{}"
  );

  adapter.db.prepare(
    `INSERT INTO comms_hub_contact_aliases
      (id, contact_id, alias_type, alias_value, provider, confidence, verified, active,
       created_at, updated_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "alias-existing", "contact-existing", "email", "existing@example.com", "one.com",
    1, 1, 1, now, now, "{}"
  );

  adapter.db.prepare(
    `INSERT INTO comms_hub_notifications
      (id, actor, conversation_id, type, title, body_text, severity, status,
       email_requested, email_sent_at, created_at, read_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "notification-existing", "system", "conversation-existing", "system", "Existing alert",
    "This alert must survive the upgrade", "warning", "unread", 1, null, now, null, "{}"
  );

  adapter.db.prepare(
    `INSERT INTO comms_hub_delayed_actions
      (id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts,
       idempotency_key, lease_owner, lease_expires_at, next_attempt_at, failure_class, error,
       created_by, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "delay-existing", "conversation-existing", "email_reply", "{}", now, "scheduled", 2, 8,
    "email-reply:existing", null, null, now, "temporary", "provider unavailable",
    "release-gate", now, now, null
  );
}

test("clean Comms Hub migration initialisation is complete and idempotent", async (t) => {
  const adapter = new SqliteD1Adapter();
  t.after(() => adapter.close());

  const first = await runCommsHubMigrations({ env: migrationEnv(), d1: adapter });
  assert.equal(first.ok, true);
  assert.equal(first.total, COMMS_HUB_REQUIRED_MIGRATIONS.length);
  assert.deepEqual(first.appliedVersions, [...COMMS_HUB_REQUIRED_MIGRATIONS]);

  const second = await runCommsHubMigrations({ env: migrationEnv(), d1: adapter });
  assert.equal(second.ok, true);
  assert.equal(second.applied, 0);
  assert.deepEqual(second.appliedVersions, []);

  const applied = adapter.db.prepare("SELECT version FROM comms_hub_schema_migrations ORDER BY version").all();
  assert.deepEqual(applied.map((row) => row.version), [...COMMS_HUB_REQUIRED_MIGRATIONS]);

  const heartbeatColumns = adapter.db.prepare("PRAGMA table_info(comms_hub_worker_heartbeats)").all();
  assert.ok(heartbeatColumns.length > 0, "latest migration must create the worker heartbeat schema");
});

test("upgrade from migration 0020 preserves communication state and backfills pending notification delivery", async (t) => {
  const adapter = new SqliteD1Adapter();
  t.after(() => adapter.close());

  applyHistoricalSnapshot(adapter, "0020_professional_autonomous_comms");
  seedExistingCommunications(adapter);

  const result = await runCommsHubMigrations({ env: migrationEnv(), d1: adapter });
  assert.deepEqual(result.appliedVersions, [
    "0021_notification_delivery_reliability",
    "0022_worker_heartbeat",
  ]);

  const message = adapter.db.prepare(
    "SELECT body_text FROM comms_hub_messages WHERE id = ?"
  ).get("message-existing");
  assert.equal(message.body_text, "Preserve this communication state");

  const alias = adapter.db.prepare(
    "SELECT alias_value, alias_type FROM comms_hub_contact_aliases WHERE id = ?"
  ).get("alias-existing");
  assert.deepEqual({ ...alias }, { alias_value: "existing@example.com", alias_type: "email" });

  const delayed = adapter.db.prepare(
    "SELECT status, attempts, idempotency_key FROM comms_hub_delayed_actions WHERE id = ?"
  ).get("delay-existing");
  assert.deepEqual(
    { ...delayed },
    { status: "scheduled", attempts: 2, idempotency_key: "email-reply:existing" }
  );

  const notification = adapter.db.prepare(
    `SELECT email_delivery_status, email_requested, email_sent_at
       FROM comms_hub_notifications WHERE id = ?`
  ).get("notification-existing");
  assert.equal(notification.email_requested, 1);
  assert.equal(notification.email_sent_at, null);
  assert.equal(notification.email_delivery_status, "pending");

  const backfill = adapter.db.prepare(
    `SELECT action_type, status, idempotency_key
       FROM comms_hub_delayed_actions WHERE idempotency_key = ?`
  ).get("notification-email:notification-existing");
  assert.deepEqual(
    { ...backfill },
    {
      action_type: "notification_email",
      status: "scheduled",
      idempotency_key: "notification-email:notification-existing",
    }
  );
});

test("a failed migration is not recorded and a retry resumes from the last committed version", async (t) => {
  const adapter = new SqliteD1Adapter({ failMigrationVersion: "0021_notification_delivery_reliability" });
  t.after(() => adapter.close());

  await assert.rejects(
    () => runCommsHubMigrations({ env: migrationEnv(), d1: adapter }),
    (error) => {
      assert.match(error.message, /Comms Hub migration 0021_notification_delivery_reliability failed/);
      assert.equal(error.migration, "0021_notification_delivery_reliability");
      assert.match(
        error.cause?.message || "",
        /Synthetic migration failure for 0021_notification_delivery_reliability/
      );
      return true;
    }
  );

  const afterFailure = adapter.db.prepare(
    "SELECT version FROM comms_hub_schema_migrations ORDER BY version"
  ).all();
  assert.equal(afterFailure.at(-1)?.version, "0020_professional_autonomous_comms");
  assert.equal(
    adapter.db.prepare("SELECT COUNT(*) AS count FROM comms_hub_schema_migrations WHERE version = ?")
      .get("0021_notification_delivery_reliability").count,
    0
  );

  const retry = await runCommsHubMigrations({ env: migrationEnv(), d1: adapter });
  assert.deepEqual(retry.appliedVersions, [
    "0021_notification_delivery_reliability",
    "0022_worker_heartbeat",
  ]);

  const finalPass = await runCommsHubMigrations({ env: migrationEnv(), d1: adapter });
  assert.equal(finalPass.applied, 0);
});
