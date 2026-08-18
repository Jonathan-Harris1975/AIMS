import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { stableId } from "../services/comms-hub/domain/ids.js";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../services/comms-hub/migrations/manifest.js";
import { CommsHubRepository } from "../services/comms-hub/repositories/commsRepository.js";
import { CommsOperationsRepository } from "../services/comms-hub/repositories/commsOperationsRepository.js";
import { CommsHubOperationsService } from "../services/comms-hub/operationsService.js";
import { CommsHubGovernanceService } from "../services/comms-hub/governanceService.js";
import { CommsHubMonthEndConversationArchiveWorker } from "../services/comms-hub/workers/monthEndConversationArchiveWorker.js";

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const migration of COMMS_HUB_REQUIRED_MIGRATIONS) {
      this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}.sql`, import.meta.url), "utf8"));
    }
  }

  query(sql, params = []) {
    const statement = this.db.prepare(sql);
    return { success: true, results: statement.all(...params) };
  }

  batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map(({ sql, params = [] }) => this.query(sql, params));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function insertContact(d1, { id, email = "person@example.com", name = "Person", phone = "+44 7700 900123", at = "2026-06-01T10:00:00.000Z" }) {
  d1.query(
    `INSERT INTO comms_hub_contacts (id, primary_email, display_name, phone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, email, name, phone, at, at]
  );
}

function insertConversation(d1, {
  id,
  contactId,
  status = "open",
  subject = "Test conversation",
  at = "2026-06-15T10:00:00.000Z",
  sourceReference = null,
}) {
  d1.query(
    `INSERT INTO comms_hub_conversations
      (id, channel, provider, workflow, status, contact_id, subject, source_reference,
       created_at, updated_at, last_message_at, metadata_json)
     VALUES (?, 'email', 'onecom', 'general_enquiry', ?, ?, ?, ?, ?, ?, ?, '{}')`,
    [id, status, contactId, subject, sourceReference || `source:${id}`, at, at, at]
  );
}

function insertMessage(d1, { id, conversationId, body = "History that should be deleted", at = "2026-06-15T10:01:00.000Z" }) {
  d1.query(
    `INSERT INTO comms_hub_messages
      (id, conversation_id, direction, sender, recipients_json, subject, body_text, body_html,
       provider_message_id, received_at, created_at, metadata_json)
     VALUES (?, ?, 'inbound', 'person@example.com', '[]', 'Re: Test', ?, NULL, ?, ?, ?, '{}')`,
    [id, conversationId, body, `provider:${id}`, at, at]
  );
}

function makeContext(d1) {
  const repository = new CommsHubRepository(d1);
  const operationsRepository = new CommsOperationsRepository(d1);
  const auditEvents = [];
  const context = {
    repository,
    operationsRepository,
    auditService: { async record(event) { auditEvents.push(event); } },
    aiRepository: { async cancelFollowUpsForConversation() {} },
  };
  context.operationsService = new CommsHubOperationsService({ context });
  context.governanceService = new CommsHubGovernanceService({ context });
  return { context, auditEvents };
}

const adminRequest = { id: "req-test", commsIdentity: { actor: "Jonathan", role: "admin" } };

test("contact fields can be edited and saved", async () => {
  const d1 = new SqliteD1();
  const contactId = stableId("ctc", "edit-contact");
  insertContact(d1, { id: contactId });
  const { context } = makeContext(d1);

  const profile = await context.operationsService.updateContact({
    contactId,
    displayName: "Jane Example",
    primaryEmail: "Jane.Example@Example.com",
    phone: "+44 20 7946 0123",
  }, adminRequest);

  assert.equal(profile.contact.display_name, "Jane Example");
  assert.equal(profile.contact.primary_email, "jane.example@example.com");
  assert.equal(profile.contact.phone, "+44 20 7946 0123");
  const indexed = d1.query(`SELECT searchable_text FROM comms_hub_search_documents WHERE object_type = 'contact' AND object_id = ?`, [contactId]).results[0];
  assert.match(indexed.searchable_text, /Jane Example/);
});

test("deleting a contact preserves linked conversations without broken contact references", async () => {
  const d1 = new SqliteD1();
  const contactId = stableId("ctc", "delete-contact");
  const conversationId = stableId("cnv", "linked-conversation");
  insertContact(d1, { id: contactId });
  insertConversation(d1, { id: conversationId, contactId });
  const { context } = makeContext(d1);

  const result = await context.operationsService.deleteContact(contactId, adminRequest);

  assert.equal(result.linkedConversationCount, 1);
  assert.equal(d1.query(`SELECT COUNT(*) AS count FROM comms_hub_contacts WHERE id = ?`, [contactId]).results[0].count, 0);
  const conversation = d1.query(`SELECT contact_id FROM comms_hub_conversations WHERE id = ?`, [conversationId]).results[0];
  assert.equal(conversation.contact_id, result.replacementContactId);
  const replacement = d1.query(`SELECT display_name, primary_email, phone FROM comms_hub_contacts WHERE id = ?`, [result.replacementContactId]).results[0];
  assert.equal(replacement.display_name, "Deleted contact");
  assert.equal(replacement.primary_email, null);
  assert.equal(replacement.phone, null);
});

test("conversation deletion removes the conversation and its message history", async () => {
  const d1 = new SqliteD1();
  const contactId = stableId("ctc", "conversation-delete-contact");
  const conversationId = stableId("cnv", "conversation-delete");
  const messageId = stableId("msg", "conversation-delete-message");
  insertContact(d1, { id: contactId });
  insertConversation(d1, { id: conversationId, contactId });
  insertMessage(d1, { id: messageId, conversationId });
  const { context } = makeContext(d1);

  const result = await context.governanceService.deleteConversation({ conversationId, actor: "Jonathan" });

  assert.equal(result.hardDeletion, true);
  assert.equal(result.deleted, true);
  assert.equal(d1.query(`SELECT COUNT(*) AS count FROM comms_hub_conversations WHERE id = ?`, [conversationId]).results[0].count, 0);
  assert.equal(d1.query(`SELECT COUNT(*) AS count FROM comms_hub_messages WHERE conversation_id = ?`, [conversationId]).results[0].count, 0);
});

test("monthly archive stores closed conversations and leaves open conversations active", async () => {
  const d1 = new SqliteD1();
  const contactId = stableId("ctc", "archive-contact");
  const closedId = stableId("cnv", "archive-closed");
  const openId = stableId("cnv", "archive-open");
  insertContact(d1, { id: contactId });
  insertConversation(d1, { id: closedId, contactId, status: "closed", subject: "Closed thread", at: "2026-06-25T10:00:00.000Z" });
  insertMessage(d1, { id: stableId("msg", "archive-closed-message"), conversationId: closedId, body: "Preserve me", at: "2026-06-25T10:01:00.000Z" });
  insertConversation(d1, { id: openId, contactId, status: "open", subject: "Open thread", at: "2026-06-26T10:00:00.000Z" });
  insertMessage(d1, { id: stableId("msg", "archive-open-message"), conversationId: openId, body: "Still active", at: "2026-06-26T10:01:00.000Z" });
  const { context } = makeContext(d1);
  context.config = {
    monthEndArchiveEnabled: true,
    monthEndArchivePollMs: 21_600_000,
    monthEndArchiveBatchSize: 100,
    businessTimeZone: "Europe/London",
  };
  const worker = new CommsHubMonthEndConversationArchiveWorker({ context });

  const result = await worker.runOnce({ now: "2026-08-18T08:00:00.000Z" });

  assert.equal(result.archived, 1);
  const archives = await context.operationsRepository.listConversationArchives();
  assert.deepEqual(archives.map((item) => item.conversation_id), [closedId]);
  const archive = await context.operationsRepository.getConversationArchive(closedId);
  assert.equal(archive.snapshot.conversation.messages[0].body_text, "Preserve me");
  const closedOps = await context.operationsRepository.getConversationOperations(closedId);
  assert.equal(closedOps.operational_status, "archived");
  assert.equal(await context.operationsRepository.getConversationOperations(openId), null);
  const activeQueue = await context.operationsRepository.listUnifiedQueue({ limit: 20 });
  assert.deepEqual(activeQueue.map((item) => item.id), [openId]);
});
