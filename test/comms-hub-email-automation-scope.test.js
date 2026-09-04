import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { CommsOperationsRepository } from "../services/comms-hub/repositories/commsOperationsRepository.js";
import { CommsAiRepository } from "../services/comms-hub/repositories/commsAiRepository.js";
import { conversationAutomationExclusion } from "../services/comms-hub/domain/automationScope.js";

class SqliteD1 {
  constructor({ includeScopeMigration = true } = {}) {
    this.db = new DatabaseSync(":memory:");
    for (const name of [
      "0001_comms_hub", "0002_zernio_social", "0003_ai_workflows", "0004_hardening",
      "0005_operations_and_channels", "0006_smart_response_forms", "0007_business_hours_and_handoff",
      "0008_full_channel_activation", "0009_outreach_automation", "0010_runtime_reliability",
      "0011_contact_deletion_and_conversation_archives",
      ...(includeScopeMigration ? ["0012_excluded_email_automation_scope"] : []),
    ]) this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  query(sql, params = []) { return { success: true, results: this.db.prepare(sql).all(...params) }; }
}

function seedEmailConversation(d1, accountKey, idSuffix, status = "open") {
  const at = "2026-08-01T10:00:00.000Z";
  const contactId = `ctc_${idSuffix}`;
  const conversationId = `cnv_${idSuffix}`;
  d1.query(`INSERT INTO comms_hub_contacts (id, primary_email, display_name, phone, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)`, [contactId, `${idSuffix}@example.com`, idSuffix, at, at]);
  d1.query(`INSERT INTO comms_hub_conversations (id, channel, provider, workflow, status, contact_id, subject, source_reference, created_at, updated_at, last_message_at, \
metadata_json) VALUES (?, 'email', 'one.com', 'email_inbox', ?, ?, ?, ?, ?, ?, ?, ?)`, [conversationId, status, contactId, idSuffix, `source-${idSuffix}`, at, at, at, JSON.stringify({ accountKey })]);
  d1.query(`INSERT INTO comms_hub_email_threads (id, conversation_id, account_key, mailbox, provider_thread_key, internet_message_id, references_json, last_uid, created_at, \
updated_at, metadata_json) VALUES (?, ?, ?, 'INBOX', ?, ?, '[]', 1, ?, ?, '{}')`, [`eth_${idSuffix}`, conversationId, accountKey, `thread-${idSuffix}`, `<${idSuffix}@example.com>`, at, at]);
  return { contactId, conversationId };
}

test("scope helper identifies Admin and Newsletter email conversations only", () => {
  assert.equal(conversationAutomationExclusion({ channel: "email", metadata: { accountKey: "admin" } })?.accountKey, "admin");
  assert.equal(conversationAutomationExclusion({ channel: "email", metadata_json: JSON.stringify({ accountKey: "newsletter" }) })?.accountKey, "newsletter");
  assert.equal(conversationAutomationExclusion({ channel: "email", metadata: { accountKey: "info" } }), null);
  assert.equal(conversationAutomationExclusion({ channel: "facebook", metadata: { accountKey: "admin" } }), null);
});

test("Unified Inbox, delayed actions and follow-ups exclude legacy Admin/Newsletter conversations", async () => {
  const d1 = new SqliteD1();
  const admin = seedEmailConversation(d1, "admin", "admin");
  const newsletter = seedEmailConversation(d1, "newsletter", "newsletter");
  const info = seedEmailConversation(d1, "info", "info");
  const operations = new CommsOperationsRepository(d1);
  const ai = new CommsAiRepository(d1);
  const now = "2026-08-18T09:00:00.000Z";

  for (const [id, conversationId] of [["da-admin", admin.conversationId], ["da-newsletter", newsletter.conversationId], ["da-info", info.conversationId]]) {
    d1.query(`INSERT INTO comms_hub_delayed_actions (id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts, idempotency_key, next_attempt_at, \
created_by, created_at, updated_at) VALUES (?, ?, 'notification', '{}', ?, 'scheduled', 0, 8, ?, ?, 'test', ?, ?)`, [id, conversationId, now, `idem-${id}`, now, now, now]);
  }
  for (const [id, conversationId] of [["fu-admin", admin.conversationId], ["fu-newsletter", newsletter.conversationId], ["fu-info", info.conversationId]]) {
    d1.query(`INSERT INTO comms_hub_follow_ups (id, conversation_id, ai_run_id, reason, due_at, status, attempts, lease_owner, lease_expires_at, next_attempt_at, completed_at, \
cancelled_at, failure_class, error, idempotency_key, metadata_json, created_at, updated_at) VALUES (?, ?, NULL, 'test', ?, 'scheduled', 0, NULL, NULL, ?, NULL, NULL, NULL, \
NULL, ?, '{}', ?, ?)`, [id, conversationId, now, now, `idem-${id}`, now, now]);
  }

  const queue = await operations.listUnifiedQueue({ limit: 20 });
  assert.deepEqual(queue.map((row) => row.id), [info.conversationId]);

  const excludedById = await operations.claimDelayedActionById({ id: "da-admin", workerId: "worker", now, leaseExpiresAt: "2026-08-18T09:03:00.000Z" });
  assert.equal(excludedById, null);
  d1.query(`UPDATE comms_hub_delayed_actions SET status = 'failed' WHERE id = 'da-newsletter'`);
  const excludedReplay = await operations.resetDelayedActionForReplay("da-newsletter", now);
  assert.equal(excludedReplay, null);

  const delayed = await operations.claimDelayedAction({ workerId: "worker", now, leaseExpiresAt: "2026-08-18T09:03:00.000Z" });
  assert.equal(delayed.id, "da-info");
  const followUp = await ai.claimFollowUp({ workerId: "worker", now, leaseExpiresAt: "2026-08-18T09:03:00.000Z", maxAttempts: 8 });
  assert.equal(followUp.id, "fu-info");

  d1.query(`UPDATE comms_hub_conversations SET status = 'closed', updated_at = '2026-07-01T00:00:00.000Z'`);
  const archiveCandidates = await operations.listClosedBeforeArchiveCutoff("2026-08-01T00:00:00.000Z", 20);
  assert.deepEqual(archiveCandidates.map((row) => row.conversation_id), [info.conversationId]);
});

test("scope migration cancels queued automation from an older multi-mailbox deployment", () => {
  const d1 = new SqliteD1({ includeScopeMigration: false });
  const admin = seedEmailConversation(d1, "admin", "legacy-admin");
  const now = "2026-08-18T09:00:00.000Z";
  d1.query(`INSERT INTO comms_hub_delayed_actions (id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts, idempotency_key, next_attempt_at, \
created_by, created_at, updated_at) VALUES ('da-legacy', ?, 'notification', '{}', ?, 'scheduled', 0, 8, 'idem-da-legacy', ?, 'test', ?, ?)`, [admin.conversationId, now, now, now, now]);
  d1.query(`INSERT INTO comms_hub_follow_ups (id, conversation_id, ai_run_id, reason, due_at, status, attempts, lease_owner, lease_expires_at, next_attempt_at, completed_at, \
cancelled_at, failure_class, error, idempotency_key, metadata_json, created_at, updated_at) VALUES ('fu-legacy', ?, NULL, 'test', ?, 'scheduled', 0, NULL, NULL, ?, NULL, NULL, \
NULL, NULL, 'idem-fu-legacy', '{}', ?, ?)`, [admin.conversationId, now, now, now, now]);

  d1.db.exec(readFileSync(new URL("../services/comms-hub/migrations/0012_excluded_email_automation_scope.sql", import.meta.url), "utf8"));

  const delayed = d1.query(`SELECT status, failure_class, error FROM comms_hub_delayed_actions WHERE id = 'da-legacy'`).results[0];
  const followUp = d1.query(`SELECT status, cancelled_at, failure_class, error FROM comms_hub_follow_ups WHERE id = 'fu-legacy'`).results[0];
  assert.equal(delayed.status, "cancelled");
  assert.equal(delayed.failure_class, "permanent");
  assert.equal(delayed.error, "email_account_outside_comms_hub_automation");
  assert.equal(followUp.status, "cancelled");
  assert.ok(followUp.cancelled_at);
  assert.equal(followUp.failure_class, "permanent");
  assert.equal(followUp.error, "email_account_outside_comms_hub_automation");
});
