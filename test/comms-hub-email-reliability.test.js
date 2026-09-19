import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { COMMS_HUB_REQUIRED_MIGRATIONS } from '../services/comms-hub/migrations/manifest.js';
import { CommsOperationsRepository } from '../services/comms-hub/repositories/commsOperationsRepository.js';
import { CommsHubEmailService } from '../services/comms-hub/emailService.js';

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.queryCalls = 0;
    this.batchCalls = 0;
    for (const migration of COMMS_HUB_REQUIRED_MIGRATIONS) {
      this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}.sql`, import.meta.url), 'utf8'));
    }
    this.db.exec('PRAGMA foreign_keys = OFF');
  }
  query(sql, params = []) {
    this.queryCalls += 1;
    return { success: true, results: this.db.prepare(sql).all(...params) };
  }
  batch(statements) {
    this.batchCalls += 1;
    return statements.map(({ sql, params = [] }) => ({ success: true, results: this.db.prepare(sql).all(...params) }));
  }
}

test('failed outbound email idempotency claim can be reacquired for a safe retry', async () => {
  const repo = new CommsOperationsRepository(new SqliteD1());
  const base = { id: 'act-1', idempotencyKey: 'email:retry:1', conversationId: 'conv-1', channel: 'email', actionType: 'reply', requestSha256: 'sha-1' };
  const first = await repo.claimChannelOutboundAction(base);
  assert.equal(first.acquired, true);
  assert.equal(first.action.attempts, 1);

  await repo.failChannelOutboundAction({ idempotencyKey: base.idempotencyKey, failureClass: 'temporary', error: 'connection failed', reconciliationRequired: false });
  const second = await repo.claimChannelOutboundAction(base);
  assert.equal(second.acquired, true);
  assert.equal(second.retry, true);
  assert.equal(second.action.status, 'processing');
  assert.equal(second.action.attempts, 2);
});

test('email poll state is initialised and leased in one D1 request', async () => {
  const d1 = new SqliteD1();
  const repo = new CommsOperationsRepository(d1);
  const claimed = await repo.claimEmailPollState({
    accountKey: 'info',
    mailbox: 'INBOX',
    workerId: 'worker-1',
    now: '2026-09-19T20:00:00.000Z',
    leaseExpiresAt: '2026-09-19T20:05:00.000Z',
  });
  assert.equal(d1.queryCalls, 1);
  assert.equal(claimed.lease_owner, 'worker-1');
  assert.equal(claimed.attempts, 1);

  const skipped = await repo.claimEmailPollState({
    accountKey: 'info',
    mailbox: 'INBOX',
    workerId: 'worker-2',
    now: '2026-09-19T20:01:00.000Z',
    leaseExpiresAt: '2026-09-19T20:06:00.000Z',
  });
  assert.equal(d1.queryCalls, 2);
  assert.equal(skipped, null);
});

test('delivery-uncertain outbound email remains reconciliation-required and is not resent automatically', async () => {
  const repo = new CommsOperationsRepository(new SqliteD1());
  const base = { id: 'act-2', idempotencyKey: 'email:uncertain:1', conversationId: 'conv-2', channel: 'email', actionType: 'reply', requestSha256: 'sha-2' };
  await repo.claimChannelOutboundAction(base);
  await repo.failChannelOutboundAction({ idempotencyKey: base.idempotencyKey, failureClass: 'temporary', error: 'socket dropped after DATA', reconciliationRequired: true });
  const retry = await repo.claimChannelOutboundAction(base);
  assert.equal(retry.acquired, false);
  assert.equal(retry.duplicate, false);
  assert.equal(retry.existing.status, 'reconciliation_required');
});

test('pre-DATA SMTP failure is marked retryable instead of reconciliation-required', async () => {
  let failureRecord = null;
  const context = {
    config: {
      emailEnabled: true,
      emailInitialReplyDelayEnabled: false,
      emailExternalRecipientsEnabled: false,
      badLanguageBlockEnabled: true,
      emailMaxReplyChars: 20_000,
      oneComEmailAddress: 'info@jonathan-harris.online',
      emailAccounts: { info: { key: 'info', enabled: true, address: 'info@jonathan-harris.online', mailbox: 'INBOX', manualOnly: false } },
    },
    repository: {
      async getConversation() {
        return {
          id: 'conv-3', channel: 'email', status: 'open', subject: 'Question',
          contact: { primary_email: 'sender@example.com' }, messages: [{ direction: 'inbound' }],
        };
      },
    },
    operationsRepository: {
      async getConversationWorkspace() { return { operations: { operational_status: 'open' }, emailThread: { account_key: 'info', references_json: '[]' } }; },
      async claimChannelOutboundAction() { return { acquired: true }; },
      async failChannelOutboundAction(value) { failureRecord = value; },
    },
    oneComMailAccounts: {
      info: {
        async sendMessage() {
          const error = Object.assign(new Error('auth failed'), { failureClass: 'temporary', retryable: true, deliveryUncertain: false, providerStage: 'auth' });
          throw error;
        },
      },
    },
  };
  const service = new CommsHubEmailService({ context });
  await assert.rejects(() => service.send({ conversationId: 'conv-3', bodyText: 'Reply', idempotencyKey: 'email:conv-3:1', scheduledDelivery: true }));
  assert.equal(failureRecord.reconciliationRequired, false);
});

import { CommsHubProviderHealthService } from '../services/comms-hub/providerHealthService.js';
import { CommsHubDelayedActionWorker } from '../services/comms-hub/workers/delayedActionWorker.js';

test('provider health exposes enabled one.com email as unavailable when credentials are missing', async () => {
  const recorded = [];
  const context = {
    config: {
      emailEnabled: true,
      oneComEmailAddress: 'info@jonathan-harris.online',
      oneComEmailUsername: 'info@jonathan-harris.online',
      oneComEmailPassword: '',
      oneComImapHost: 'imap.one.com',
      oneComSmtpHost: 'send.one.com',
      zernioFamilies: {},
      aiEnabled: false,
      providerHealthStaleMs: 300_000,
      providerHealthFailureThreshold: 3,
    },
    aiRepository: {
      async recordProviderHealthBatch(values) { recorded.push(...values); },
      async listLatestProviderHealth() { return recorded; },
    },
  };
  const service = new CommsHubProviderHealthService({ context, snapshotProvider: () => ({ providers: {}, releaseId: null }) });
  const captured = await service.capture();
  const imap = captured.find((item) => item.provider === 'one.com-imap');
  const smtp = captured.find((item) => item.provider === 'one.com-smtp');
  assert.equal(imap.status, 'unavailable');
  assert.equal(smtp.status, 'unavailable');
});

test('exhausted durable email automation retry creates a critical internal warning', async () => {
  const notifications = [];
  const quarantined = [];
  const failed = [];
  const context = {
    config: { aiEnabled: true, autonomousRepliesEnabled: true },
    repository: {
      async getConversation(id) { return { id, channel: 'email', status: 'open', metadata: { accountKey: 'info' }, messages: [] }; },
    },
    operationsRepository: {
      async getConversationOperations() { return { operational_status: 'open', owner_type: null }; },
      async failDelayedAction(value) { failed.push(value); return value; },
    },
    aiWorkflowService: { async analyseConversation() { throw Object.assign(new Error('provider unavailable'), { failureClass: 'temporary', code: 'provider_timeout' }); } },
    governanceService: { async attemptAutonomousReply() { throw new Error('must not send'); } },
    quarantineService: { async quarantine(value) { quarantined.push(value); return value; } },
    notificationService: { async create(value) { notifications.push(value); return value; } },
  };
  const worker = new CommsHubDelayedActionWorker({ context });
  const result = await worker.process({
    id: 'delay-email-1', conversation_id: 'conv-email-1', action_type: 'recheck',
    payload_json: JSON.stringify({ inboundAutomationRetry: true, triggerMessageId: 'msg-email-1' }),
    attempts: 8, max_attempts: 8, idempotency_key: 'retry-email-1',
  });
  assert.equal(result.status, 'quarantined');
  assert.equal(failed[0].status, 'quarantined');
  assert.equal(quarantined.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].severity, 'critical');
  assert.match(notifications[0].title, /email reply needs attention/i);
});
