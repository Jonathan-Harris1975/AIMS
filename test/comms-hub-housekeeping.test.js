import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../services/comms-hub/migrations/manifest.js";
import { CommsOperationsRepository } from "../services/comms-hub/repositories/commsOperationsRepository.js";
import { CommsHousekeepingRepository } from "../services/comms-hub/repositories/commsHousekeepingRepository.js";
import { CommsHubAuditService } from "../services/comms-hub/auditService.js";
import { CommsHubEmailArchiveService, resolveArchiveMailbox } from "../services/comms-hub/emailArchiveService.js";
import {
  COMMS_HUB_HOUSEKEEPING_CONFIRMATION,
  CommsHubHousekeepingService,
} from "../services/comms-hub/housekeepingService.js";
import { sha256Hex } from "../services/comms-hub/domain/ids.js";

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

  batch(statements) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(({ sql, params = [] }) => this.query(sql, params));
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

function seedConversation(d1, { id, status = "open", operationalStatus = "open", accountKey = null, uid = null }) {
  const at = "2024-01-01T00:00:00.000Z";
  const contactId = `contact-${id}`;
  d1.db.prepare(`INSERT INTO comms_hub_contacts
    (id, primary_email, display_name, phone, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)`)
    .run(contactId, `${id}@example.com`, id, at, at);
  d1.db.prepare(`INSERT INTO comms_hub_conversations
    (id, channel, provider, workflow, status, contact_id, subject, source_reference,
     created_at, updated_at, last_message_at, metadata_json)
    VALUES (?, ?, 'one.com', 'email_inbox', ?, ?, ?, ?, ?, ?, ?, '{}')`)
    .run(id, accountKey ? "email" : "form", status, contactId, id, `source-${id}`, at, at, at);
  d1.db.prepare(`INSERT INTO comms_hub_conversation_operations
    (conversation_id, operational_status, version, updated_by, updated_at, resolved_at)
    VALUES (?, ?, 1, 'test', ?, ?)`)
    .run(id, operationalStatus, at, ["resolved", "archived"].includes(operationalStatus) ? at : null);
  if (accountKey) {
    const messageId = `message-${id}`;
    d1.db.prepare(`INSERT INTO comms_hub_messages
      (id, conversation_id, direction, sender, recipients_json, subject, body_text, body_html,
       provider_message_id, received_at, created_at, metadata_json)
      VALUES (?, ?, 'inbound', 'person@example.com', '[]', 'Subject', 'Body', NULL, ?, ?, ?, ?)`)
      .run(messageId, id, `provider-${id}`, at, at, JSON.stringify({ uid }));
    d1.db.prepare(`INSERT INTO comms_hub_email_threads
      (id, conversation_id, account_key, mailbox, provider_thread_key, internet_message_id,
       references_json, last_uid, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, 'INBOX', ?, NULL, '[]', ?, ?, ?, '{}')`)
      .run(`thread-${id}`, id, accountKey, `thread-key-${id}`, uid, at, at);
  }
}

test("housekeeping migration provides a conservative active baseline retention policy", async (t) => {
  const d1 = new SqliteD1();
  t.after(() => d1.close());
  const housekeeping = new CommsHousekeepingRepository(d1);
  assert.equal(await housekeeping.activeRetentionPolicyCount(), 1);
  const policy = d1.db.prepare("SELECT policy_key, retain_days, action FROM comms_hub_retention_policies").get();
  assert.deepEqual({ ...policy }, { policy_key: "baseline_archive_365", retain_days: 365, action: "archive" });
});

test("retention health warns once without letting a dry run mutate notifications", async () => {
  const notifications = [];
  const service = new CommsHubHousekeepingService({ context: {
    config: { housekeepingNotificationActor: "admin" },
    housekeepingRepository: { async activeRetentionPolicyCount() { return 0; } },
    notificationService: { async create(input) { notifications.push(input); return input; } },
  } });
  const at = new Date("2026-09-22T00:00:00.000Z");
  await assert.rejects(
    () => service.retentionPolicyHealth({ at, dryRun: false }),
    (error) => error?.code === "retention_policy_missing"
  );
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].idempotencySeed, "retention-policy-missing:2026-09-22");
  await assert.rejects(
    () => service.retentionPolicyHealth({ at, dryRun: true }),
    (error) => error?.code === "retention_policy_missing"
  );
  assert.equal(notifications.length, 1);
});

test("automatic retention considers only old closed or resolved conversations", async (t) => {
  const d1 = new SqliteD1();
  t.after(() => d1.close());
  seedConversation(d1, { id: "conversation-open", status: "open", operationalStatus: "open" });
  seedConversation(d1, { id: "conversation-resolved", status: "open", operationalStatus: "resolved" });
  const repository = new CommsOperationsRepository(d1);
  const candidates = await repository.listDueRetentionCandidates("2026-09-22T00:00:00.000Z", 20);
  assert.deepEqual(candidates.map((item) => item.conversation_id), ["conversation-resolved"]);
});

test("database janitor removes resolved quarantine history but never unresolved items", async (t) => {
  const d1 = new SqliteD1();
  t.after(() => d1.close());
  const insert = d1.db.prepare(`INSERT INTO comms_hub_quarantine_items
    (id, source_type, source_id, conversation_id, failure_class, status, payload_reference,
     error_code, error_message, attempts, idempotency_key, created_at, updated_at, resolved_at, metadata_json)
    VALUES (?, 'test', ?, NULL, 'recoverable', ?, NULL, NULL, NULL, 0, ?, ?, ?, ?, '{}')`);
  insert.run("qua-open", "open", "quarantined", "quarantine:test:open", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z", null);
  insert.run("qua-done", "done", "resolved", "quarantine:test:done", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z");
  const repository = new CommsHousekeepingRepository(d1);
  const result = await repository.runDatabaseJanitor({
    at: "2026-09-22T00:00:00.000Z",
    recordCutoff: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(result.quarantineItemsDeleted, 1);
  assert.deepEqual(d1.db.prepare("SELECT id FROM comms_hub_quarantine_items ORDER BY id").all().map((row) => row.id), ["qua-open"]);
});

test("audit archive persists a checksum checkpoint before rows are pruned", async (t) => {
  const d1 = new SqliteD1();
  t.after(() => d1.close());
  const operationsRepository = new CommsOperationsRepository(d1);
  const housekeepingRepository = new CommsHousekeepingRepository(d1);
  const auditService = new CommsHubAuditService({ repository: operationsRepository });
  await auditService.record({ actor: "test", role: "admin", action: "old_one", objectType: "test", occurredAt: "2024-01-01T00:00:00.000Z" });
  await auditService.record({ actor: "test", role: "admin", action: "old_two", objectType: "test", occurredAt: "2024-01-02T00:00:00.000Z" });
  const stored = [];
  const service = new CommsHubHousekeepingService({ context: {
    config: { housekeepingAuditArchiveEnabled: true, housekeepingAuditRetentionDays: 365, housekeepingAuditBatchSize: 500 },
    privateR2: {
      async putText(key, body) {
        stored.push({ key, body });
        return { key, sha256: sha256Hex(body) };
      },
    },
    housekeepingRepository,
  } });
  const result = await service.archiveAuditTrail({ at: new Date("2026-09-22T00:00:00.000Z"), dryRun: false });
  assert.equal(result.archived, 2);
  assert.equal(stored.length, 1);
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS count FROM comms_hub_audit_events").get().count, 0);
  const checkpoint = d1.db.prepare("SELECT last_chain_sha256, payload_sha256 FROM comms_hub_audit_archive_segments").get();
  assert.equal(checkpoint.payload_sha256, sha256Hex(stored[0].body));
  const next = await auditService.record({ actor: "test", role: "admin", action: "new_event", objectType: "test", occurredAt: "2026-09-22T00:01:00.000Z" });
  assert.equal(next.chainPreviousSha256, checkpoint.last_chain_sha256);
});

test("Info archival uses only the advertised Archive folder and persisted resolved mail", async (t) => {
  assert.equal(resolveArchiveMailbox([
    { name: "INBOX", selectable: true, flags: [] },
    { name: "Stored", selectable: true, flags: ["\\Archive"] },
  ]), "Stored");
  assert.throws(() => resolveArchiveMailbox([{ name: "Archive", selectable: true, flags: [] }]),
    (error) => error?.code === "email_archive_special_use_folder_unresolved");

  const d1 = new SqliteD1();
  t.after(() => d1.close());
  seedConversation(d1, { id: "info-resolved", status: "closed", operationalStatus: "resolved", accountKey: "info", uid: 41 });
  seedConversation(d1, { id: "info-open", status: "open", operationalStatus: "open", accountKey: "info", uid: 42 });
  seedConversation(d1, { id: "admin-resolved", status: "closed", operationalStatus: "resolved", accountKey: "admin", uid: 43 });
  const moved = [];
  const housekeepingRepository = new CommsHousekeepingRepository(d1);
  const service = new CommsHubEmailArchiveService({ context: {
    config: {
      emailArchiveEnabled: true,
      emailArchiveAfterDays: 90,
      emailArchiveBatchSize: 100,
      emailAccounts: { info: { enabled: true, mailbox: "INBOX" } },
    },
    housekeepingRepository,
    oneComMailAccounts: { info: {
      async listMailboxes() { return [{ name: "Stored", selectable: true, flags: ["\\Archive"] }]; },
      async moveMessages(input) { moved.push(input); return { movedUids: input.uids, missingUids: [] }; },
    } },
  } });
  const result = await service.run({ now: new Date("2026-09-22T00:00:00.000Z") });
  assert.equal(result.moved, 1);
  assert.deepEqual(moved[0].uids, [41]);
  const metadata = JSON.parse(d1.db.prepare("SELECT metadata_json FROM comms_hub_messages WHERE id = 'message-info-resolved'").get().metadata_json);
  assert.ok(metadata.providerArchivedAt);
  assert.equal(metadata.providerArchiveMailbox, "Stored");
});

test("monthly orchestration requires confirmation and reports every required stage", async () => {
  const finished = [];
  const context = {
    config: { housekeepingEnabled: true, businessTimeZone: "Europe/London" },
    housekeepingRepository: {
      async beginRun(input) { return { created: true, run: input }; },
      async finishRun(input) { finished.push(input); return input; },
    },
    auditService: { async record() {} },
  };
  const service = new CommsHubHousekeepingService({ context });
  service.executeStage = async (name) => ({ stage: name });
  await assert.rejects(
    () => service.run({ runType: "monthly", now: new Date("2026-09-01T03:00:00.000Z") }),
    (error) => error?.code === "housekeeping_confirmation_required"
  );
  const result = await service.run({
    runType: "monthly",
    confirmation: COMMS_HUB_HOUSEKEEPING_CONFIRMATION,
    now: new Date("2026-09-01T03:00:00.000Z"),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.stages.map((stage) => stage.name), [
    "retention_policy_health",
    "database_janitor",
    "quarantine_review",
    "private_storage_reconciliation",
    "telemetry",
    "backup_restore_and_rotation",
    "info_mailbox_archive",
  ]);
  assert.equal(finished[0].status, "complete");
});
