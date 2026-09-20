import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { COMMS_HUB_REQUIRED_MIGRATIONS } from '../services/comms-hub/migrations/manifest.js';
import { CommsOperationsRepository } from '../services/comms-hub/repositories/commsOperationsRepository.js';
import { CommsHubRepository } from '../services/comms-hub/repositories/commsRepository.js';
import { CommsHubNotificationService } from '../services/comms-hub/notificationService.js';
import { CommsHubDelayedActionWorker } from '../services/comms-hub/workers/delayedActionWorker.js';
import { CommsHubQuarantineService } from '../services/comms-hub/quarantineService.js';
import { CommsHubChatService } from '../services/comms-hub/chatService.js';
import { CommsHubWorkflowEngineService } from '../services/comms-hub/workflowEngineService.js';
import { CommsHubContentAutomationService } from '../services/comms-hub/contentAutomationService.js';
import { notifyHumanHandoff, recordCallbackEmail } from '../services/comms-hub/humanContactService.js';

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    for (const migration of COMMS_HUB_REQUIRED_MIGRATIONS) {
      this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}.sql`, import.meta.url), 'utf8'));
    }
  }

  query(sql, params = []) {
    return { success: true, results: this.db.prepare(sql).all(...params) };
  }

  batch(statements) {
    this.db.exec('BEGIN');
    try {
      const output = statements.map(({ sql, params = [] }) => this.query(sql, params));
      this.db.exec('COMMIT');
      return output;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function seedConversation(d1, { id = 'conv-notification-1', contactId = 'contact-notification-1', channel = 'chat' } = {}) {
  const at = '2026-09-21T10:00:00.000Z';
  d1.query(
    `INSERT INTO comms_hub_contacts (id, primary_email, display_name, phone, created_at, updated_at)
     VALUES (?, 'visitor@example.com', 'Visitor', NULL, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [contactId, at, at],
  );
  d1.query(
    `INSERT INTO comms_hub_conversations
      (id, channel, provider, workflow, status, contact_id, subject, source_reference,
       created_at, updated_at, last_message_at, metadata_json)
     VALUES (?, ?, 'test', 'test', 'open', ?, 'Test conversation', ?, ?, ?, ?, '{}')
     ON CONFLICT(id) DO NOTHING`,
    [id, channel, contactId, `source:${id}`, at, at, at],
  );
  return { id, contactId };
}

function temporaryError(message = 'temporary provider failure') {
  return Object.assign(new Error(message), {
    code: 'provider_temporarily_unavailable',
    failureClass: 'temporary',
    retryable: true,
    deliveryUncertain: false,
  });
}

function permanentError(message = 'provider rejected recipient') {
  return Object.assign(new Error(message), {
    code: 'provider_rejected',
    failureClass: 'permanent',
    retryable: false,
    deliveryUncertain: false,
  });
}

function uncertainError(message = 'connection lost after provider DATA acceptance may have occurred') {
  return Object.assign(new Error(message), {
    code: 'provider_delivery_uncertain',
    failureClass: 'temporary',
    retryable: true,
    deliveryUncertain: true,
  });
}

function durableContext(d1, sendSystemNotification) {
  const operationsRepository = new CommsOperationsRepository(d1);
  const context = {
    operationsRepository,
    config: {
      delayedActionBatchSize: 20,
      delayedActionLeaseMs: 60_000,
      delayedActionWorkerEnabled: true,
      delayedActionPollMs: 10_000,
    },
    emailService: { sendSystemNotification },
    auditService: { async record() {} },
  };
  context.notificationService = new CommsHubNotificationService({ context });
  context.quarantineService = new CommsHubQuarantineService({ context });
  return context;
}

async function createEmailNotification(context, seed = 'email-notification-1', overrides = {}) {
  return context.notificationService.create({
    actor: 'admin',
    conversationId: overrides.conversationId ?? null,
    type: overrides.type || 'system',
    title: overrides.title || 'Critical operational notification',
    bodyText: overrides.bodyText || 'A durable notification email must be sent.',
    severity: overrides.severity || 'critical',
    emailRequested: true,
    idempotencySeed: seed,
    metadata: overrides.metadata || {},
  });
}

function actionForNotification(d1, notificationId) {
  return d1.query(
    `SELECT * FROM comms_hub_delayed_actions WHERE idempotency_key = ?`,
    [`notification-email:${notificationId}`],
  ).results[0] || null;
}

test('migration 0021 upgrades an existing database without data loss and backfills unsent requested email', () => {
  const db = new DatabaseSync(':memory:');
  const historical = COMMS_HUB_REQUIRED_MIGRATIONS.filter((name) => name !== '0021_notification_delivery_reliability');
  for (const migration of historical) {
    db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}.sql`, import.meta.url), 'utf8'));
  }
  db.prepare(`INSERT INTO comms_hub_contacts (id, primary_email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run('legacy-contact', 'legacy@example.com', 'Legacy Contact', '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z');
  db.prepare(`INSERT INTO comms_hub_contact_aliases
    (id, contact_id, alias_type, alias_value, provider, confidence, verified, active, created_at, updated_at, metadata_json)
    VALUES (?, ?, 'email', ?, 'one.com', 1, 1, 1, ?, ?, '{}')`)
    .run('legacy-alias', 'legacy-contact', 'legacy@example.com', '2026-09-01T09:00:00.000Z', '2026-09-01T09:00:00.000Z');
  db.prepare(`INSERT INTO comms_hub_notifications
    (id, actor, conversation_id, type, title, body_text, severity, status, email_requested, email_sent_at, created_at, metadata_json)
    VALUES (?, 'admin', 'legacy-deleted-conversation', 'system', 'Legacy pending email', 'Preserve me', 'critical', 'unread', 1, NULL, ?, '{}')`)
    .run('legacy-notification', '2026-09-01T09:00:00.000Z');

  db.exec(readFileSync(new URL('../services/comms-hub/migrations/0021_notification_delivery_reliability.sql', import.meta.url), 'utf8'));

  const notification = db.prepare(`SELECT * FROM comms_hub_notifications WHERE id = 'legacy-notification'`).get();
  assert.equal(notification.body_text, 'Preserve me');
  assert.equal(notification.email_delivery_status, 'pending');
  assert.equal(notification.conversation_id, 'legacy-deleted-conversation');
  const action = db.prepare(`SELECT * FROM comms_hub_delayed_actions WHERE idempotency_key = 'notification-email:legacy-notification'`).get();
  assert.equal(action.action_type, 'notification_email');
  assert.equal(action.conversation_id, null);
  assert.equal(action.status, 'scheduled');
  assert.equal(JSON.parse(action.payload_json).notificationId, 'legacy-notification');
  assert.equal(db.prepare(`SELECT alias_value FROM comms_hub_contact_aliases WHERE id = 'legacy-alias'`).get().alias_value, 'legacy@example.com');
  assert.match(db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='comms_hub_contact_aliases'`).get().sql, /callback_email/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('notification schema accepts every production-emitted type, rejects unsupported types, and preserves idempotency', async () => {
  const d1 = new SqliteD1();
  const operationsRepository = new CommsOperationsRepository(d1);
  const context = { operationsRepository };
  context.notificationService = new CommsHubNotificationService({ context });

  const emittedTypes = [
    'assignment', 'mention', 'escalation', 'sla_warning', 'sla_breach', 'failure', 'system',
    'human_handoff_requested', 'human_callback', 'content_quality_review',
  ];
  for (const type of emittedTypes) {
    const notification = await context.notificationService.create({
      actor: 'admin', type, title: `Type ${type}`, bodyText: 'Schema contract test',
      severity: 'info', emailRequested: false, idempotencySeed: `type:${type}`,
    });
    assert.equal(notification.type, type);
  }

  await assert.rejects(
    () => context.notificationService.create({
      actor: 'admin', type: 'unsupported_future_type', title: 'Invalid', bodyText: 'Must fail',
      severity: 'info', emailRequested: false, idempotencySeed: 'invalid-type',
    }),
    /CHECK constraint failed|constraint/i,
  );

  const first = await context.notificationService.create({
    actor: 'admin', type: 'system', title: 'Idempotent', bodyText: 'Same payload',
    severity: 'warning', emailRequested: false, idempotencySeed: 'same-notification',
  });
  const second = await context.notificationService.create({
    actor: 'admin', type: 'system', title: 'Idempotent', bodyText: 'Same payload',
    severity: 'warning', emailRequested: false, idempotencySeed: 'same-notification',
  });
  assert.equal(second.id, first.id);
  const count = d1.query(`SELECT COUNT(*) AS count FROM comms_hub_notifications WHERE id = ?`, [first.id]).results[0].count;
  assert.equal(Number(count), 1);
});

test('social outbound idempotency does not conceal database contract violations', async () => {
  const d1 = new SqliteD1();
  const repository = new CommsHubRepository(d1);
  const { id: conversationId } = seedConversation(d1, { id: 'conv-social-contract', contactId: 'contact-social-contract', channel: 'social' });

  await assert.rejects(
    () => repository.claimOutboundAction({
      id: 'social-action-invalid-family',
      idempotencyKey: 'social-invalid-family',
      conversationId,
      family: 'unsupported-family',
      platform: 'facebook',
      actionType: 'reply',
      requestSha256: 'abc123',
      now: '2026-09-21T10:00:00.000Z',
    }),
    /CHECK constraint failed|constraint/i,
  );
});

test('notification email persists pending work, sends once, and records durable provider success', async () => {
  const d1 = new SqliteD1();
  const sends = [];
  const context = durableContext(d1, async (notification) => {
    sends.push(notification.id);
    return { messageId: '<provider-message-1@example.test>' };
  });
  const notification = await createEmailNotification(context, 'success');

  assert.equal(notification.email_delivery_status, 'pending');
  assert.equal(actionForNotification(d1, notification.id)?.status, 'scheduled');

  const worker = new CommsHubDelayedActionWorker({ context });
  const run = await worker.runOnce({ limit: 1 });
  assert.equal(run.processed, 1);
  assert.equal(run.results[0].status, 'complete');
  assert.deepEqual(sends, [notification.id]);

  const persisted = await context.operationsRepository.getNotification(notification.id);
  assert.equal(persisted.email_delivery_status, 'sent');
  assert.ok(persisted.email_sent_at);
  assert.equal(persisted.email_provider_message_id, '<provider-message-1@example.test>');
  assert.equal(actionForNotification(d1, notification.id).status, 'complete');
});

test('temporary notification email failure retries with bounded durable state and then succeeds', async () => {
  const d1 = new SqliteD1();
  let attempts = 0;
  const context = durableContext(d1, async () => {
    attempts += 1;
    if (attempts === 1) throw temporaryError();
    return { messageId: '<retry-success@example.test>' };
  });
  const notification = await createEmailNotification(context, 'retry-success');
  const worker = new CommsHubDelayedActionWorker({ context });

  const first = await worker.runOnce({ limit: 1 });
  assert.equal(first.results[0].status, 'retry');
  let persisted = await context.operationsRepository.getNotification(notification.id);
  assert.equal(persisted.email_delivery_status, 'retry_pending');
  let action = actionForNotification(d1, notification.id);
  assert.equal(action.status, 'scheduled');
  assert.equal(Number(action.attempts), 1);

  const due = new Date(Date.now() - 1_000).toISOString();
  d1.query(`UPDATE comms_hub_delayed_actions SET due_at = ?, next_attempt_at = ? WHERE id = ?`, [due, due, action.id]);
  const second = await worker.runOnce({ limit: 1 });
  assert.equal(second.results[0].status, 'complete');
  assert.equal(attempts, 2);
  persisted = await context.operationsRepository.getNotification(notification.id);
  assert.equal(persisted.email_delivery_status, 'sent');
  assert.equal(persisted.email_provider_message_id, '<retry-success@example.test>');
});

test('temporary notification email failure is quarantined when its retry budget is exhausted', async () => {
  const d1 = new SqliteD1();
  const context = durableContext(d1, async () => { throw temporaryError('still down'); });
  const notification = await createEmailNotification(context, 'retry-exhaustion');
  d1.query(`UPDATE comms_hub_delayed_actions SET max_attempts = 1 WHERE idempotency_key = ?`, [`notification-email:${notification.id}`]);

  const worker = new CommsHubDelayedActionWorker({ context });
  const run = await worker.runOnce({ limit: 1 });
  assert.equal(run.results[0].status, 'quarantined');
  const persisted = await context.operationsRepository.getNotification(notification.id);
  assert.equal(persisted.email_delivery_status, 'quarantined');
  assert.equal(actionForNotification(d1, notification.id).status, 'quarantined');
  const quarantine = d1.query(`SELECT * FROM comms_hub_quarantine_items WHERE source_id = ?`, [actionForNotification(d1, notification.id).id]).results[0];
  assert.ok(quarantine);
});

test('permanent provider rejection is quarantined immediately instead of being retried', async () => {
  const d1 = new SqliteD1();
  let attempts = 0;
  const context = durableContext(d1, async () => { attempts += 1; throw permanentError(); });
  const notification = await createEmailNotification(context, 'permanent-rejection');
  const worker = new CommsHubDelayedActionWorker({ context });

  const run = await worker.runOnce({ limit: 1 });
  assert.equal(run.results[0].status, 'quarantined');
  assert.equal(attempts, 1);
  const persisted = await context.operationsRepository.getNotification(notification.id);
  assert.equal(persisted.email_delivery_status, 'quarantined');
  assert.equal(persisted.email_failure_class, 'permanent');
});

test('delivery-uncertain notification email enters reconciliation and can be manually authorised for retry', async () => {
  const d1 = new SqliteD1();
  let mode = 'uncertain';
  let sends = 0;
  const context = durableContext(d1, async () => {
    sends += 1;
    if (mode === 'uncertain') throw uncertainError();
    return { messageId: '<reconciled-success@example.test>' };
  });
  const notification = await createEmailNotification(context, 'uncertain');
  const worker = new CommsHubDelayedActionWorker({ context });

  const first = await worker.runOnce({ limit: 1 });
  assert.equal(first.results[0].status, 'quarantined');
  let persisted = await context.operationsRepository.getNotification(notification.id);
  assert.equal(persisted.email_delivery_status, 'reconciliation_required');
  assert.equal(persisted.email_failure_class, 'uncertain');
  assert.equal(actionForNotification(d1, notification.id).status, 'quarantined');

  const noAutomaticRetry = await worker.runOnce({ limit: 1 });
  assert.equal(noAutomaticRetry.processed, 0);
  assert.equal(sends, 1);

  mode = 'success';
  const reconciled = await context.notificationService.reconcileEmail({ id: notification.id, outcome: 'retry', actor: 'admin' });
  assert.equal(reconciled.email_delivery_status, 'retry_pending');
  assert.equal(actionForNotification(d1, notification.id).status, 'scheduled');

  const second = await worker.runOnce({ limit: 1 });
  assert.equal(second.results[0].status, 'complete');
  assert.equal(sends, 2);
  persisted = await context.operationsRepository.getNotification(notification.id);
  assert.equal(persisted.email_delivery_status, 'sent');
});

test('service restart and worker concurrency do not lose or duplicate pending notification email', async () => {
  const d1 = new SqliteD1();
  const initial = durableContext(d1, async () => { throw new Error('initial process must not send'); });
  const notification = await createEmailNotification(initial, 'restart');

  let sends = 0;
  const restarted = durableContext(d1, async () => { sends += 1; return { messageId: '<restart@example.test>' }; });
  const workerA = new CommsHubDelayedActionWorker({ context: restarted });
  const workerB = new CommsHubDelayedActionWorker({ context: restarted });
  const now = new Date();
  const claimedA = await restarted.operationsRepository.claimDelayedAction({
    workerId: workerA.workerId,
    now: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
  });
  assert.equal(claimedA.action_type, 'notification_email');
  const claimedB = await restarted.operationsRepository.claimDelayedAction({
    workerId: workerB.workerId,
    now: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
  });
  assert.equal(claimedB, null);

  const result = await workerA.process(claimedA);
  assert.equal(result.status, 'complete');
  assert.equal(sends, 1);
  const persisted = await restarted.operationsRepository.getNotification(notification.id);
  assert.equal(persisted.email_delivery_status, 'sent');

  const replay = await workerA.execute(claimedA);
  assert.equal(replay.duplicate, true);
  assert.equal(sends, 1);
});

test('worker repairs a missing queue row for a persisted pending notification', async () => {
  const d1 = new SqliteD1();
  let sends = 0;
  const context = durableContext(d1, async () => { sends += 1; return { messageId: '<recovered@example.test>' }; });
  const notification = await createEmailNotification(context, 'queue-repair');
  d1.query(`DELETE FROM comms_hub_delayed_actions WHERE idempotency_key = ?`, [`notification-email:${notification.id}`]);
  assert.equal(actionForNotification(d1, notification.id), null);

  const worker = new CommsHubDelayedActionWorker({ context });
  const run = await worker.runOnce({ limit: 1 });
  assert.equal(run.processed, 1);
  assert.equal(sends, 1);
  assert.equal((await context.operationsRepository.getNotification(notification.id)).email_delivery_status, 'sent');
});

test('production handoff, callback, content-review, and critical escalation paths create real persisted notifications', async () => {
  const d1 = new SqliteD1();
  const operationsRepository = new CommsOperationsRepository(d1);
  const repository = new CommsHubRepository(d1);
  const context = {
    operationsRepository,
    repository,
    config: {
      chatEnabled: true,
      chatMaxMessageChars: 4_000,
      chatMaxMessagesPerMinute: 30,
      chatHistoryLimit: 100,
      smartConductEnabled: false,
      conductReviewStrikeThreshold: 3,
      conductAutomationBlockThreshold: 5,
      businessTimeZone: 'Europe/London',
      businessStartHour: 9,
      businessEndHour: 17,
      badLanguageBlockEnabled: true,
      coginPalApiBaseUrl: '',
      chatAiWorkflowEnabled: false,
      aiEnabled: false,
      callbackEmailCaptureEnabled: true,
      jotformForms: { contact: { url: 'https://example.test/contact' } },
    },
    now: () => '2026-09-21T10:00:00.000Z',
    coginPal: {
      async readWebhook() {
        return {
          nonce: 'nonce-chat-handoff',
          payloadSha256: 'sha-chat-handoff',
          payload: {
            sessionId: 'session-handoff', visitorId: 'visitor-handoff', websiteId: 'jonathan-harris.online',
            message: { id: 'provider-chat-1', text: 'I would like to speak with a human.' }, requestHuman: true,
          },
        };
      },
    },
    auditService: { async record() {} },
    workflowEngineService: { async evaluate() { return { matched: false }; } },
  };
  context.notificationService = new CommsHubNotificationService({ context });
  context.chatService = new CommsHubChatService({ context });

  const accepted = await context.chatService.acceptWebhook({});
  assert.equal(accepted.takeoverRequested, true);
  let handoffRows = d1.query(`SELECT * FROM comms_hub_notifications WHERE type = 'human_handoff_requested' ORDER BY created_at`).results;
  assert.equal(handoffRows.length, 1);
  assert.equal(handoffRows[0].email_requested, 1);
  assert.equal(actionForNotification(d1, handoffRows[0].id)?.conversation_id, null);

  await notifyHumanHandoff({
    context,
    conversationId: accepted.conversationId,
    reason: 'low_answerability',
    idempotencySeed: 'coginpal-human-review',
  });
  handoffRows = d1.query(`SELECT * FROM comms_hub_notifications WHERE type = 'human_handoff_requested' ORDER BY created_at`).results;
  assert.equal(handoffRows.length, 2);
  assert.ok(handoffRows.every((row) => Number(row.email_requested) === 1));

  const conversation = await repository.getConversation(accepted.conversationId);
  await recordCallbackEmail({
    context,
    conversationId: accepted.conversationId,
    contactId: conversation.contact.id,
    channel: 'chat',
    provider: 'coginpal',
    bodyText: 'Please contact me at callback@example.com',
    at: '2026-09-21T10:02:00.000Z',
  });
  const callbackAlias = d1.query(`SELECT * FROM comms_hub_contact_aliases WHERE alias_type = 'callback_email'`).results[0];
  assert.equal(callbackAlias.alias_value, 'callback@example.com');
  assert.equal(d1.query(`SELECT COUNT(*) AS count FROM comms_hub_notifications WHERE type = 'human_callback'`).results[0].count, 1);

  const contentAutomation = new CommsHubContentAutomationService({ context });
  await contentAutomation.holdForReview({
    conversationId: accepted.conversationId,
    formKey: 'case_study',
    quality: { score: 0.41 },
    threshold: 0.7,
    reason: 'quality_below_threshold',
  });
  assert.equal(d1.query(`SELECT COUNT(*) AS count FROM comms_hub_notifications WHERE type = 'content_quality_review'`).results[0].count, 1);

  const workflow = new CommsHubWorkflowEngineService({ context });
  await workflow.escalate({
    conversationId: accepted.conversationId,
    category: 'security',
    severity: 'critical',
    reason: 'Critical workflow escalation integration test',
    assignedTo: 'admin',
  }, { actor: 'test-admin', role: 'admin' });
  const escalation = d1.query(`SELECT * FROM comms_hub_notifications WHERE type = 'escalation' ORDER BY created_at DESC LIMIT 1`).results[0];
  assert.ok(escalation);
  assert.equal(escalation.severity, 'critical');
  assert.equal(Number(escalation.email_requested), 1);
  assert.ok(actionForNotification(d1, escalation.id));
});
