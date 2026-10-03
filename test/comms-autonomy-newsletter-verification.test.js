import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { attachmentStatesSafe, attachmentReviewState } from '../services/comms-hub/domain/attachmentReview.js';
import { CommsHubFormProcessingService } from '../services/comms-hub/formProcessingService.js';
import { sendReplyDraft } from '../services/comms-hub/replyDraftService.js';
import { primaryHoldReason } from '../services/comms-hub/domain/autonomyOutcome.js';
import { CommsOperationsRepository } from '../services/comms-hub/repositories/commsOperationsRepository.js';
import { beginSubscription, confirmSubscription, createUnsubscribeToken, unsubscribe, listEligibleSubscribers } from '../services/newsletter/audience/d1Audience.js';
import { sendSubscriptionConfirmation, trustedNewsletterBase } from '../services/newsletter/confirmationDelivery.js';
import { loadCommsHubConfig, getCommsHubMissingEnv, booleanValue } from '../services/comms-hub/config.js';
import { isNewsletterTokenRequest, requireAimsBearerAuth } from '../services/shared/middleware/suiteAuth.js';
import { redactNewsletterUrl } from '../services/shared/http/redactNewsletterUrl.js';
import express from 'express';
import request from 'supertest';
import { createNewsletterSubscriptionRouter } from '../services/newsletter/routes/subscriptions.js';
import { delayedBusinessReplyAt, isWithinBusinessHours } from '../services/comms-hub/domain/businessHours.js';
import { COMMS_HUB_REQUIRED_MIGRATIONS } from '../services/comms-hub/migrations/manifest.js';
import { CommsHubWorkflowEngineService } from '../services/comms-hub/workflowEngineService.js';
import { CommsHubDelayedActionWorker } from '../services/comms-hub/workers/delayedActionWorker.js';
import { newsletterRequestSignals } from '../services/newsletter/telemetry.js';
import { processNewsletterJotformSignup } from '../services/newsletter/jotformIntake.js';
import { rawLog } from '../logger.js';
import { createCommsHubRouter } from '../services/comms-hub/routes/index.js';
import { CommsHubOperationsService } from '../services/comms-hub/operationsService.js';

function database(t, full = false) {
  const db = new DatabaseSync(':memory:');
  // Newsletter and outcome schemas are exercised with SQLite, not SQL matching mocks.
  if (!full) db.exec('CREATE TABLE comms_hub_conversations(id TEXT PRIMARY KEY)');
  for (const name of full ? COMMS_HUB_REQUIRED_MIGRATIONS : ['0024_newsletter_audience', '0025_autonomy_newsletter_reliability']) {
    db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  t.after(() => db.close());
  const d1 = {
    db,
    async query(sql, params = []) { return { results: db.prepare(sql).all(...params) }; },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const { sql, params } of statements) results.push(await this.query(sql, params));
        db.exec('COMMIT');
        return results;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  return d1;
}

const safeAttachment = { attachment_status: 'stored', scan_status: 'clean', sha256: 'a'.repeat(64), object_key: 'attachments/day/id/hash-file',
  bucket_name: 'private', scan_provider: 'test-scanner', scanned_at: '2026-10-01T09:00:00Z' };

test('operator queue route applies owner and AI filters through the actual repository', async (t) => {
  const d1 = database(t, true);
  const at = '2026-10-01T09:00:00Z';
  d1.db.prepare('INSERT INTO comms_hub_contacts(id,created_at,updated_at) VALUES(?,?,?)').run('contact', at, at);
  const repo = new CommsOperationsRepository(d1);
  for (const [id, owner, aiStatus] of [['first', 'operator-a', 'complete'], ['second', 'operator-b', 'complete'], ['third', 'operator-a', 'failed']]) {
    d1.db.prepare(`INSERT INTO comms_hub_conversations(id,channel,provider,workflow,status,contact_id,subject,source_reference,created_at,updated_at,last_message_at,metadata_json)
      VALUES(?,'form','test','test','open','contact','',?,?,?,?,'{}')`).run(id, id, at, at, at);
    await repo.assignConversation({ conversationId: id, ownerType: 'person', ownerId: owner, actor: 'fixture' });
    d1.db.prepare('INSERT INTO comms_hub_ai_runs(id,conversation_id,operation,status,started_at) VALUES(?,?,?,?,?)').run(id, id, 'test', aiStatus, at);
  }
  const context = { config: { suiteRole: 'read_only' }, operationsRepository: repo, auditService: { async record() {} } };
  context.operationsService = new CommsHubOperationsService({ context });
  const app = express();
  app.use('/comms-hub', createCommsHubRouter({ contextProvider: () => context }));
  const response = await request(app).get('/comms-hub/queue?ownerId=operator-a&aiStatus=complete');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.conversations.map(row => row.id), ['first']);
  const alias = await request(app).get('/comms-hub/queue?owner=operator-a&aiStatus=failed');
  assert.deepEqual(alias.body.conversations.map(row => row.id), ['third']);
});

test('attachment clearance requires scan proof, promotion and all expected records', () => {
  assert.equal(attachmentStatesSafe([safeAttachment], 1), true);
  assert.equal(attachmentStatesSafe([], 1), false);
  for (const change of [{ attachment_status: 'quarantined' }, { attachment_status: 'failed' }, { scan_status: 'pending' }, { scan_status: null },
    { object_key: 'quarantine/file' }, { scanned_at: null }, { sha256: '' }, { deleted_at: '2026-10-02' }, { scan_provider: null }]) {
    assert.equal(attachmentStatesSafe([{ ...safeAttachment, ...change }], 1), false);
    assert.equal(attachmentStatesSafe([safeAttachment, { ...safeAttachment, ...change }], 2), false);
  }
});

test('attachment status-read errors fail closed', async () => {
  const result = await attachmentReviewState({ operationsRepository: { async listAttachmentReviewStates() { throw new Error('offline'); } } }, 'conversation', {});
  assert.equal(result.reviewRequired, true);
  assert.equal(result.reason, 'status_read_failed');
});

function formContext() {
  let sends = 0;
  let row = safeAttachment;
  const state = { status: 'digest_ready', digest: { attachmentCount: 1, attachmentReviewRequired: true } };
  const draft = { id: 'draft', conversation_id: 'form', status: 'draft', requires_approval: 0, body_text: 'Response', evidence_ids_json: '[]' };
  const context = {
    config: { aiEnabled: true, formSmartProcessingEnabled: true, formAutoSendEnabled: true },
    operationsRepository: {
      async getFormProcessing() { return state; },
      async listAttachmentReviewStates() { return [row]; },
      async getConversationOperations() { return { operational_status: 'open' }; },
      async updateFormProcessing(input) { state.status = input.status; state.reply_draft_id = input.replyDraftId || state.reply_draft_id; },
      async updateFormAttachmentReview({ required }) { state.digest.attachmentReviewRequired = required; },
    },
    repository: { async getConversation() { return { id: 'form', channel: 'form', status: 'open', attachments: [{ id: 'attachment' }] }; } },
    aiRepository: { async getDraft() { return draft; }, async markDraftSent({ metadata }) { draft.status = 'sent'; draft.metadata = metadata; return draft; } },
    aiWorkflowService: { async analyseConversation() { return { draft: { id: 'draft', requiresApproval: false }, responseIntelligence: { autonomousEligible: true } }; } },
    replyDelivery: { async send() { sends += 1; return { providerMessageId: 'test-receipt' }; } },
  };
  return { context, state, draft, get sends() { return sends; }, set row(value) { row = value; } };
}

test('clean Jotform attachment clears intake review and retry cannot send twice', async () => {
  const fixture = formContext();
  const service = new CommsHubFormProcessingService({ context: fixture.context });
  assert.equal((await service.processConversation('form')).sent, true);
  assert.equal(fixture.state.digest.attachmentReviewRequired, false);
  assert.equal((await service.processConversation('form')).duplicate, true);
  assert.equal(fixture.sends, 1);
});

test('quarantine change during analysis blocks the final dispatch', async () => {
  const fixture = formContext();
  const analyse = fixture.context.aiWorkflowService.analyseConversation;
  fixture.context.aiWorkflowService.analyseConversation = async () => {
    fixture.row = { ...safeAttachment, attachment_status: 'quarantined' };
    return analyse();
  };
  await assert.rejects(new CommsHubFormProcessingService({ context: fixture.context }).processConversation('form'), { code: 'form_attachment_review_required' });
  assert.equal(fixture.sends, 0);
});

test('delayed dispatch rechecks changed attachment state', async () => {
  const fixture = formContext();
  fixture.row = { ...safeAttachment, scan_status: 'infected' };
  await assert.rejects(sendReplyDraft({ draftId: 'draft', context: fixture.context, scheduledDelivery: true, autonomous: true }), { code: 'form_attachment_review_required' });
  assert.equal(fixture.sends, 0);
});

test('queued autonomous drafts honour current disablement and human takeover without blocking manual replies', async () => {
  for (const override of [{ autonomousRepliesEnabled: false }, { aiEnabled: false }, { humanOwner: true }]) {
    const fixture = formContext();
    Object.assign(fixture.context.config, override);
    if (override.humanOwner) fixture.context.operationsRepository.getConversationOperations = async () => ({ operational_status: 'open', owner_type: 'person' });
    let held;
    fixture.context.operationsRepository.recordAutonomyOutcome = async (input) => { held = input; };
    await assert.rejects(sendReplyDraft({ draftId: 'draft', context: fixture.context, scheduledDelivery: true, autonomous: true }), {
      code: override.humanOwner ? 'autonomous_reply_human_assigned' : 'autonomous_replies_disabled',
    });
    assert.equal(fixture.sends, 0);
    assert.equal(held.reason, override.humanOwner ? 'approval_required' : 'automation_disabled');
    await sendReplyDraft({ draftId: 'draft', context: fixture.context, scheduledDelivery: true });
    assert.equal(fixture.sends, 1);
  }
});

test('attachment review can resume the existing eligible draft after clean promotion', async () => {
  const fixture = formContext();
  fixture.row = { ...safeAttachment, scan_status: 'pending' };
  fixture.draft.metadata = { smartLayers: { responseIntelligence: { autonomousEligible: true } } };
  const service = new CommsHubFormProcessingService({ context: fixture.context });
  assert.equal((await service.processConversation('form')).sent, false);
  assert.equal(fixture.sends, 0);
  fixture.row = safeAttachment;
  assert.equal((await service.processConversation('form')).sent, true);
  assert.equal(fixture.sends, 1);
});

test('retained calendar-day reply delay rolls DST weekends to Monday business hours', () => {
  for (const [receivedAt, monday] of [['2026-03-27T16:00:00Z', '2026-03-30'], ['2026-10-23T15:00:00Z', '2026-10-26']]) {
    const due = delayedBusinessReplyAt({ receivedAt, seed: 'dst-boundary', minimumDays: 2, maximumDays: 3 });
    assert.equal(due.toISOString().slice(0, 10), monday);
    assert.equal(isWithinBusinessHours(due, { timeZone: 'Europe/London', startHour: 9, endHour: 17 }), true);
  }
});

test('real durable scheduler waits until the retained due time and dispatches once across DST', async (t) => {
  const at = '2026-10-23T15:00:00.000Z';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(at) });
  const d1 = database(t, true);
  d1.db.prepare('INSERT INTO comms_hub_contacts(id,created_at,updated_at) VALUES(?,?,?)').run('contact', at, at);
  d1.db.prepare(`INSERT INTO comms_hub_conversations(id,channel,provider,workflow,status,contact_id,subject,source_reference,created_at,updated_at,last_message_at,metadata_json)
    VALUES('c','email','one.com','email_intake','open','contact','Subject','source',?,?,?,'{}')`).run(at, at, at);
  const conversation = { id: 'c', channel: 'email', status: 'open', created_at: at, messages: [{ direction: 'inbound', received_at: at }], attachments: [] };
  let sends = 0;
  const draft = { id: 'draft', conversation_id: 'c', status: 'draft', requires_approval: 0, body_text: 'Reply', evidence_ids_json: '[]' };
  const context = {
    config: { emailInitialReplyDelayEnabled: true, replyDelayMinDays: 2, replyDelayMaxDays: 3, businessTimeZone: 'Europe/London',
      businessStartHour: 9, businessEndHour: 17, delayedActionBatchSize: 5, delayedActionLeaseMs: 60000 },
    repository: { async getConversation() { return conversation; } },
    operationsRepository: new CommsOperationsRepository(d1), auditService: { async record() {} },
    aiRepository: { async getDraft() { return draft; }, async markDraftSent({ metadata }) { draft.status = 'sent'; draft.metadata = metadata; return draft; } },
    replyDelivery: { async send() { sends += 1; return { messageId: 'receipt' }; } },
  };
  context.workflowEngineService = new CommsHubWorkflowEngineService({ context });
  const scheduled = await sendReplyDraft({ draftId: 'draft', context, autonomous: true });
  assert.equal(scheduled.scheduled, true);
  assert.equal(sends, 0);
  const worker = new CommsHubDelayedActionWorker({ context });
  t.mock.timers.setTime(Date.parse(scheduled.dueAt) - 1);
  assert.equal((await worker.runOnce()).processed, 0);
  t.mock.timers.setTime(Date.parse(scheduled.dueAt));
  const delivered = await worker.runOnce();
  assert.equal(delivered.results[0].status, 'complete');
  assert.equal(sends, 1);
  assert.equal((await worker.runOnce()).processed, 0);
  const metrics = await context.operationsRepository.metrics({ from: at, to: '2026-11-01T00:00:00Z' });
  assert.equal(metrics.autonomyOutcomes[0].outcome, 'auto_sent');
  assert.equal(metrics.autonomyOutcomes[0].count, 1);
  assert.equal(JSON.stringify(metrics).includes('contact'), false);
});

test('durable autonomy split counts conversations once; successful delivery supersedes review', async (t) => {
  const d1 = database(t);
  d1.db.exec("INSERT INTO comms_hub_conversations VALUES('c')");
  const repo = new CommsOperationsRepository(d1);
  for (let i = 0; i < 3; i += 1) await repo.recordAutonomyOutcome({ conversationId: 'c', channel: 'email', outcome: 'held_for_review', reason: 'low_confidence' });
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM comms_hub_autonomy_outcomes').get().n, 1);
  await repo.recordAutonomyOutcome({ conversationId: 'c', channel: 'email', outcome: 'auto_sent' });
  await repo.recordAutonomyOutcome({ conversationId: 'c', channel: 'email', outcome: 'held_for_review', reason: 'private@example.com' });
  assert.equal(d1.db.prepare('SELECT outcome FROM comms_hub_autonomy_outcomes').get().outcome, 'auto_sent');
  assert.equal(primaryHoldReason({ intelligence: { humanReviewRequired: true }, approval: true }), 'safety_or_conduct');
  assert.equal(primaryHoldReason({ attachmentReview: true, approval: true }), 'attachment_review');
});

test('autonomous reply parsing and validation preserve explicit booleans and aiEnabled fallback', () => {
  for (const ai of ['true', 'false']) for (const value of [undefined, '', 'malformed', 'TRUE', 'false', 'OFF', '1']) {
    const env = { COMMS_HUB_ENABLED: 'true', COMMS_HUB_AI_ENABLED: ai, COMMS_HUB_AUTONOMOUS_REPLIES_ENABLED: value };
    const expected = booleanValue(value, ai === 'true');
    assert.equal(loadCommsHubConfig({ ...env, COMMS_HUB_ENABLED: 'false' }).autonomousRepliesEnabled, expected);
    assert.equal(getCommsHubMissingEnv(env).includes('COMMS_HUB_AI_ENABLED'), expected && ai === 'false');
  }
});

test('newsletter normalised duplicates preserve active state and verification', async (t) => {
  const d1 = database(t);
  const first = await beginSubscription({ email: ' Reader@Example.com ' }, { d1 });
  assert.equal((await confirmSubscription(first.token, { d1 })).status, 'subscribed');
  const duplicate = await beginSubscription({ email: 'reader@example.com' }, { d1 });
  assert.equal(duplicate.status, 'already_subscribed');
  assert.equal((await listEligibleSubscribers('ai-edge', { d1 })).length, 1);
  assert.equal((await confirmSubscription(first.token, { d1 })).duplicate, true);
});

test('concurrent normalised subscription requests resolve the real persisted subscriber id', async (t) => {
  const d1 = database(t);
  // Serialise batches as the real D1 transaction API does, while reads race.
  const batch = d1.batch.bind(d1);
  let pending = Promise.resolve();
  d1.batch = (input) => { const result = pending.then(() => batch(input)); pending = result.catch(() => {}); return result; };
  const results = await Promise.all(['Reader@Example.com', 'reader@example.com'].map(email => beginSubscription({ email }, { d1 })));
  assert.equal(results[0].subscriberId, results[1].subscriberId);
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers').get().n, 1);
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM newsletter_subscriptions').get().n, 1);
  assert.equal((await confirmSubscription(results[0].token, { d1 })).ok, true);
});

test('confirmation fails for expiry, invalid token and late confirmation after unsubscribe', async (t) => {
  const d1 = database(t);
  const signup = await beginSubscription({ email: 'reader@example.com' }, { d1 });
  assert.equal((await confirmSubscription('invalid', { d1 })).ok, false);
  d1.db.exec("UPDATE newsletter_verification_tokens SET expires_at='2000-01-01T00:00:00Z'");
  assert.equal((await confirmSubscription(signup.token, { d1 })).ok, false);
  const newSignup = await beginSubscription({ email: 'reader@example.com' }, { d1 });
  const withdrawal = await createUnsubscribeToken(newSignup.subscriberId, 'ai-edge', { d1 });
  await unsubscribe(withdrawal, { d1 });
  assert.equal((await confirmSubscription(newSignup.token, { d1 })).status, 'suppressed');
  assert.equal((await beginSubscription({ email: 'reader@example.com' }, { d1 })).status, 'suppressed');
  assert.equal((await listEligibleSubscribers('ai-edge', { d1 })).length, 0);
});

function sendInput(d1, mail) {
  return { d1, mail, baseUrl: 'https://aims.example.com', input: { email: 'reader@example.com' },
    compose: ({ confirmationUrl }) => ({ subject: 'Confirm', bodyText: confirmationUrl }) };
}

test('verified Jotform signup records its confirmation receipt against the persisted subscriber and retries once', async (t) => {
  const d1 = database(t);
  const priorBase = process.env.COMMS_HUB_PUBLIC_BASE_URL;
  process.env.COMMS_HUB_PUBLIC_BASE_URL = 'https://aims.example.com';
  t.after(() => { if (priorBase === undefined) delete process.env.COMMS_HUB_PUBLIC_BASE_URL; else process.env.COMMS_HUB_PUBLIC_BASE_URL = priorBase; });
  let sends = 0;
  let token;
  const identifiers = { formId: '262733359026055', submissionId: 'test-submission', route: { key: 'newsletter_signup' } };
  const context = {
    d1,
    jotform: { async verifySubmission(input) {
      assert.equal(input.submissionId, identifiers.submissionId);
      return { answers: {
        1: { type: 'control_email', answer: ' Reader@Example.com ' },
        2: { name: 'emailConsent', text: 'Newsletter consent', answer: 'Yes, send me the AI Edge newsletter. I can unsubscribe.' },
      } };
    } },
    manualMailAccounts: { newsletter: { async sendMessage(message) {
      sends += 1;
      token = message.bodyText.split('\n').find(line => line.startsWith('https://aims.example.com/newsletter/confirm/')).split('/').at(-1);
      return { messageId: 'receipt' };
    } } },
  };
  const query = d1.query.bind(d1);
  let failAudit = true;
  d1.query = async (sql, params) => {
    if (failAudit && sql.includes("'confirmation_sent','consent'")) { failAudit = false; throw new Error('temporary audit failure'); }
    return query(sql, params);
  };
  await assert.rejects(processNewsletterJotformSignup({ identifiers, context }), /temporary audit failure/);
  assert.equal((await processNewsletterJotformSignup({ identifiers, context })).duplicate, true);
  const subscriber = d1.db.prepare('SELECT id,status,verified_at FROM newsletter_subscribers').get();
  const receipt = d1.db.prepare("SELECT subscriber_id FROM newsletter_consent_events WHERE event_type='confirmation_sent'").get();
  assert.equal(receipt?.subscriber_id, subscriber.id);
  assert.equal(subscriber.status, 'pending');
  assert.equal(subscriber.verified_at, null);
  assert.equal((await processNewsletterJotformSignup({ identifiers, context })).duplicate, true);
  assert.equal(d1.db.prepare("SELECT COUNT(*) AS n FROM newsletter_consent_events WHERE event_type='confirmation_sent'").get().n, 1);
  assert.equal(sends, 1);
  assert.equal((await confirmSubscription(token, { d1 })).status, 'subscribed');
  assert.equal((await listEligibleSubscribers('ai-edge', { d1 })).length, 1);
});

test('confirmation delivery is durable across duplicate requests and worker restart', async (t) => {
  const d1 = database(t);
  let sends = 0;
  let url;
  const input = sendInput(d1, { async sendMessage(message) { sends += 1; url = message.bodyText; return { messageId: 'receipt' }; } });
  const first = await sendSubscriptionConfirmation(input);
  const second = await sendSubscriptionConfirmation({ ...input });
  assert.equal(first.status, 'confirmation_sent');
  assert.equal(second.duplicate, true);
  assert.equal(sends, 1);
  assert.equal((await listEligibleSubscribers('ai-edge', { d1 })).length, 0);
  assert.equal((await confirmSubscription(url.split('/').at(-1), { d1 })).ok, true);
  const row = d1.db.prepare('SELECT * FROM newsletter_confirmation_deliveries').get();
  assert.equal(JSON.stringify(row).includes('reader@example.com'), false);
  assert.equal(JSON.stringify(row).includes(url.split('/').at(-1)), false);
});

test('transient pre-acceptance failure retries; permanent and uncertain failure never blind-retry', async (t) => {
  for (const mode of ['transient', 'permanent', 'unknown']) {
    const d1 = database(t);
    let sends = 0;
    const input = sendInput(d1, { async sendMessage() {
      sends += 1;
      if (sends === 1) throw Object.assign(new Error('provider failed'), { deliveryUncertain: mode === 'unknown', retryable: mode === 'transient' });
      return { messageId: 'receipt' };
    } });
    await assert.rejects(sendSubscriptionConfirmation(input));
    if (mode === 'transient') assert.equal((await sendSubscriptionConfirmation(input)).status, 'confirmation_sent');
    else await assert.rejects(sendSubscriptionConfirmation(input), { code: 'newsletter_confirmation_reconciliation_required' });
    assert.equal(sends, mode === 'transient' ? 2 : 1);
  }
});

test('provider acceptance followed by failed local receipt persistence requires reconciliation', async (t) => {
  const d1 = database(t);
  const query = d1.query.bind(d1);
  d1.query = async (sql, params) => {
    if (sql.includes("status='sent',expires_at=?")) throw new Error('local write failed');
    return query(sql, params);
  };
  let sends = 0;
  const input = sendInput(d1, { async sendMessage() { sends += 1; return { messageId: 'receipt' }; } });
  await assert.rejects(sendSubscriptionConfirmation(input));
  await assert.rejects(sendSubscriptionConfirmation(input), { code: 'newsletter_confirmation_reconciliation_required' });
  assert.equal(sends, 1);
  assert.equal(d1.db.prepare('SELECT status FROM newsletter_confirmation_deliveries').get().status, 'reconciliation_required');
});

test('concurrent browser-style confirmation requests acquire only one durable SMTP claim', async (t) => {
  const d1 = database(t);
  let sends = 0;
  const input = sendInput(d1, { async sendMessage() { sends += 1; return { messageId: 'receipt' }; } });
  const results = await Promise.allSettled([sendSubscriptionConfirmation(input), sendSubscriptionConfirmation(input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(sends, 1);
  assert.equal((await sendSubscriptionConfirmation(input)).duplicate, true);
});

test('HTTP subscription/confirmation flow preserves consent, pending and error semantics', async (t) => {
  const warning = t.mock.method(rawLog, 'warn', () => {});
  const d1 = database(t);
  let token;
  let issueDeliveries = 0;
  const app = express();
  app.use(express.json());
  app.use('/newsletter', createNewsletterSubscriptionRouter({
    env: { COMMS_HUB_PUBLIC_BASE_URL: 'https://aims.example.com' }, d1Provider: () => d1,
    mailer: () => ({ async sendMessage(message) { token = message.bodyText.split('\n').find(line => line.startsWith('https://')).split('/').at(-1); return { messageId: 'receipt' }; } }),
    confirm: value => confirmSubscription(value, { d1 }), withdraw: value => unsubscribe(value, { d1 }),
    deliverIssue: async () => { issueDeliveries += 1; throw new Error('optional issue storage unavailable'); },
  }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ ok: false, error: error.code || 'internal_error' }));
  assert.equal((await request(app).post('/newsletter/subscribe').send({ email: 'reader@example.com' })).status, 400);
  assert.equal((await request(app).post('/newsletter/subscribe').send({ email: 'bad', consent: true })).status, 400);
  const accepted = await request(app).post('/newsletter/subscribe').send({ email: 'reader@example.com', consent: true });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.status, 'confirmation_sent');
  assert.equal((await listEligibleSubscribers('ai-edge', { d1 })).length, 0);
  const confirmed = await request(app).get(`/newsletter/confirm/${token}`);
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.headers['referrer-policy'], 'no-referrer');
  assert.equal(confirmed.headers['cache-control'], 'no-store');
  assert.equal((await listEligibleSubscribers('ai-edge', { d1 })).length, 1);
  assert.equal((await request(app).get(`/newsletter/confirm/${token}`)).status, 200);
  assert.equal(issueDeliveries, 1);
  assert.ok(warning.mock.calls.some(call => call.arguments[1] === 'newsletter.confirmation.optionalIssueUnavailable'));
  assert.equal((await request(app).get('/newsletter/confirm/invalid')).status, 400);
  assert.equal((await request(app).post('/newsletter/subscribe').send({ email: 'reader@example.com', consent: true })).body.status, 'already_subscribed');
  const telemetry = newsletterRequestSignals();
  assert.ok(telemetry.validation_rejected >= 2);
  assert.ok(telemetry.accepted_pending >= 1);
  assert.equal(JSON.stringify(telemetry).includes('reader@example.com'), false);
});

test('invalid input/configuration fails before persistence or sending', async (t) => {
  const d1 = database(t);
  const input = sendInput(d1, { async sendMessage() { assert.fail('unexpected send'); } });
  for (const email of ['bad', '', 'a'.repeat(321) + '@example.com']) await assert.rejects(sendSubscriptionConfirmation({ ...input, input: { email } }), { code: 'newsletter_email_invalid' });
  for (const baseUrl of ['', 'http://aims.example.com', 'https://user:pass@aims.example.com', 'https://aims.example.com/path', 'https://aims.example.com?return=evil']) {
    assert.throws(() => trustedNewsletterBase(baseUrl));
  }
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers').get().n, 0);
});

test('only exact newsletter token navigation bypasses suite authentication; logs redact tokens', () => {
  const token = 'a'.repeat(43);
  const request = (path, method = 'GET') => ({ method, originalUrl: path, url: path, headers: {}, get() { return ''; } });
  for (const kind of ['confirm', 'unsubscribe']) {
    const req = request(`/newsletter/${kind}/${token}`);
    let passed = false;
    requireAimsBearerAuth(req, { status() { assert.fail('token navigation must be public'); } }, () => { passed = true; });
    assert.equal(passed, true);
    assert.equal(redactNewsletterUrl(req.url + '?x=private'), `/newsletter/${kind}/[redacted]`);
  }
  for (const req of [request('/newsletter/subscribe', 'POST'), request(`/newsletter/confirm/${token}`, 'POST'), request('/newsletter/confirm/short')]) {
    assert.equal(isNewsletterTokenRequest(req), false);
  }
});
