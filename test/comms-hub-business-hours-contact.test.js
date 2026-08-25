import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  delayedBusinessReplyAt,
  isWithinBusinessHours,
  nextBusinessOpening,
} from '../services/comms-hub/domain/businessHours.js';
import {
  callbackEmailConsent,
  extractCallbackEmail,
  humanHandoffStatus,
  recordCallbackEmail,
} from '../services/comms-hub/humanContactService.js';
import { CommsHubEmailService } from '../services/comms-hub/emailService.js';
import { CommsHubChatService } from '../services/comms-hub/chatService.js';
import { handleSocialDmHumanContact } from '../services/comms-hub/socialService.js';

const policy = { timeZone: 'Europe/London', startHour: 9, endHour: 17 };

function londonParts(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return parts;
}

test('business-hours policy is Monday-Friday 09:00-17:00 Europe/London', () => {
  assert.equal(isWithinBusinessHours('2026-08-17T08:00:00.000Z', policy), true); // 09:00 BST Monday
  assert.equal(isWithinBusinessHours('2026-08-17T15:59:00.000Z', policy), true); // 16:59 BST
  assert.equal(isWithinBusinessHours('2026-08-17T16:00:00.000Z', policy), false); // 17:00 BST
  assert.equal(isWithinBusinessHours('2026-08-16T11:00:00.000Z', policy), false); // Sunday
  assert.equal(nextBusinessOpening('2026-08-16T11:00:00.000Z', policy).toISOString(), '2026-08-17T08:00:00.000Z');
});

test('delayed replies land two or three calendar days later, rolling weekends forward, and remain inside business hours', () => {
  const due = delayedBusinessReplyAt({
    receivedAt: '2026-08-14T10:00:00.000Z', // Friday 11:00 BST
    seed: 'email-conversation-1',
    ...policy,
    minimumDays: 2,
    maximumDays: 3,
  });
  const parts = londonParts(due);
  assert.equal(parts.weekday, 'Mon');
  assert.ok(Number(parts.hour) >= 9 && Number(parts.hour) < 17);
  assert.equal(parts.day, '17');
});

test('human hand-off is unavailable outside the weekday window and exposes the next opening', () => {
  const status = humanHandoffStatus({ businessTimeZone: 'Europe/London', businessStartHour: 9, businessEndHour: 17 }, new Date('2026-08-16T18:00:00.000Z'));
  assert.equal(status.available, false);
  assert.equal(status.nextAvailableAt, '2026-08-17T08:00:00.000Z');
});

test('callback email capture requires consent unless a prior hand-off already offered email collection', async () => {
  assert.equal(extractCallbackEmail('Please email me at person@example.com'), 'person@example.com');
  assert.equal(callbackEmailConsent('person@example.com'), false);
  assert.equal(callbackEmailConsent('person@example.com', { allowBareEmail: true }), true);
  const aliases = [];
  const context = {
    config: { callbackEmailCaptureEnabled: true },
    operationsRepository: { async addContactAlias(alias) { aliases.push(alias); return alias; } },
    auditService: { async record() {} },
    notificationService: { async create() {} },
  };
  const result = await recordCallbackEmail({ context, conversationId: 'cnv-1', contactId: 'con-1', channel: 'chat', provider: 'coginpal', bodyText: 'person@example.com', allowBareEmail: true });
  assert.equal(result.value, 'person@example.com');
  assert.equal(result.verified, false);
  assert.equal(result.type, 'callback_email');
  assert.equal(aliases[0].metadata.consentPurpose, 'human_callback');
});

function emailConversation(channel = 'email') {
  return {
    id: `${channel}-1`, channel, status: 'open', subject: 'Hello', created_at: '2026-08-14T10:00:00.000Z',
    contact: { primary_email: 'person@example.com' },
    messages: [{ direction: 'inbound', received_at: '2026-08-14T10:00:00.000Z', body_text: 'Hello' }],
  };
}

function emailContext(channel = 'email') {
  const scheduled = [];
  const conversation = emailConversation(channel);
  return {
    scheduled,
    context: {
      now: () => '2026-08-14T10:00:00.000Z',
      config: {
        emailEnabled: true, emailInitialReplyDelayEnabled: true, formReplyDelayEnabled: true,
        replyDelayMinDays: 2, replyDelayMaxDays: 3,
        businessTimeZone: 'Europe/London', businessStartHour: 9, businessEndHour: 17,
        emailExternalRecipientsEnabled: false, badLanguageBlockEnabled: true, emailMaxReplyChars: 20000,
        oneComEmailAddress: 'info@jonathan-harris.online', oneComEmailAccountKey: 'info', oneComMailbox: 'INBOX',
      },
      repository: { async getConversation() { return conversation; } },
      operationsRepository: {
        async getConversationWorkspace() { return { operations: { operational_status: 'open' }, emailThread: null }; },
        async getConversationOperations() { return { operational_status: 'open' }; },
      },
      workflowEngineService: {
        async schedule(input) { scheduled.push(input); return { id: 'delay-1', due_at: input.dueAt }; },
      },
      oneComMail: { async sendMessage() { throw new Error('must not send immediately'); } },
    },
  };
}

test('first email response is scheduled instead of sent immediately', async () => {
  const { context, scheduled } = emailContext('email');
  const service = new CommsHubEmailService({ context });
  const result = await service.send({ conversationId: 'email-1', bodyText: 'Thanks for your email.', idempotencyKey: 'email:first:1' });
  assert.equal(result.scheduled, true);
  assert.equal(scheduled[0].actionType, 'email_reply');
  const parts = londonParts(result.dueAt);
  assert.equal(parts.weekday, 'Mon');
  assert.ok(Number(parts.hour) >= 9 && Number(parts.hour) < 17);
});

test('processed Jotform response uses the same delayed weekday business-hours rule', async () => {
  const { context, scheduled } = emailContext('form');
  const service = new CommsHubEmailService({ context });
  const result = await service.sendFormResponse({ conversationId: 'form-1', bodyText: 'I have reviewed the details.', idempotencyKey: 'form:first:1' });
  assert.equal(result.scheduled, true);
  assert.equal(scheduled[0].actionType, 'form_reply');
  const parts = londonParts(result.dueAt);
  assert.equal(parts.weekday, 'Mon');
  assert.ok(Number(parts.hour) >= 9 && Number(parts.hour) < 17);
});

test('website hand-off outside hours stays automated and offers callback email instead', async () => {
  const state = { session: null, messages: [], actions: new Map(), aliases: [] };
  const context = {
    now: () => '2026-08-16T18:00:00.000Z', // Sunday
    config: {
      chatEnabled: true, chatMaxMessageChars: 4000, chatMaxMessagesPerMinute: 12, chatHistoryLimit: 100,
      chatAiWorkflowEnabled: false, aiEnabled: false, smartConductEnabled: true, badLanguageBlockEnabled: true,
      conductReviewStrikeThreshold: 2, conductAutomationBlockThreshold: 2, autonomousRepliesEnabled: false,
      coginPalApiBaseUrl: '', humanHandoffBusinessHoursOnly: true,
      businessTimeZone: 'Europe/London', businessStartHour: 9, businessEndHour: 17, callbackEmailCaptureEnabled: true,
    },
    coginPal: { async readWebhook() { return { nonce: 'n1', payloadSha256: 'sha', payload: { sessionId: 's1', visitorId: 'v1', websiteId: 'jonathan-harris.online', requestHuman: true, message: { id: 'm1', text: 'Can I speak to Jonathan?' } } }; } },
    operationsRepository: {
      async getChatSession() { return state.session; }, async countRecentChatInbound() { return 0; },
      async persistChannelMessage(input) { state.messages.push(input.message); return { duplicate: false }; }, async ensureConversationOperations() {},
      async upsertChatSession(input) { state.session = { conversation_id: input.conversationId, provider_session_id: input.providerSessionId, website_id: input.websiteId, visitor_id: input.visitorId, mode: 'automation', metadata_json: JSON.stringify(input.metadata || {}) }; return state.session; },
      async updateChatTakeover({ mode }) { state.session.mode = mode; return state.session; },
      async addContactAlias(alias) { state.aliases.push(alias); return alias; }, async indexSearchDocument() {},
      async getChatSessionByConversation() { return state.session; }, async getConversationOperations() { return { operational_status: 'open' }; },
      async claimChannelOutboundAction({ idempotencyKey }) { if (state.actions.has(idempotencyKey)) return { acquired: false, duplicate: true, existing: state.actions.get(idempotencyKey) }; const row = { provider_message_id: null }; state.actions.set(idempotencyKey, row); return { acquired: true, duplicate: false, action: row }; },
      async recordOutboundMessage(input) { state.messages.push({ direction: 'outbound', bodyText: input.bodyText, providerMessageId: input.providerMessageId }); },
      async completeChannelOutboundAction({ idempotencyKey, providerMessageId }) { state.actions.get(idempotencyKey).provider_message_id = providerMessageId; }, async failChannelOutboundAction() {},
    },
    repository: { async getConversation(id) { return { id, channel: 'chat', status: 'open', messages: state.messages.map((m) => ({ direction: m.direction, body_text: m.bodyText, received_at: m.receivedAt })) }; } },
    workflowEngineService: { async evaluate() {} }, auditService: { async record() {} }, notificationService: { async create() {} },
    aiWorkflowService: { async analyseConversation() {} }, governanceService: { async attemptAutonomousReply() {} },
  };
  const service = new CommsHubChatService({ context });
  const result = await service.acceptWebhook({});
  assert.equal(result.takeoverRequested, false);
  assert.equal(result.handoffAvailable, false);
  assert.equal(result.emailCaptureOffered, true);
  assert.equal(state.session.mode, 'automation');
  assert.match(state.messages.at(-1).bodyText, /leave an email address/i);
  await assert.rejects(
    () => service.takeover({ conversationId: result.conversationId, mode: 'human', actor: 'jonathan' }),
    (error) => error.code === 'chat_handoff_outside_business_hours'
  );
});


test('business-hours migration expands delayed-action schema for email, form and draft replies', () => {
  const db = new DatabaseSync(':memory:');
  for (const migration of [
    '0001_comms_hub.sql', '0002_zernio_social.sql', '0003_ai_workflows.sql',
    '0004_hardening.sql', '0005_operations_and_channels.sql', '0006_smart_response_forms.sql',
    '0007_business_hours_and_handoff.sql',
  ]) db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}`, import.meta.url), 'utf8'));
  const now = '2026-08-17T08:00:00.000Z';
  db.prepare(`INSERT INTO comms_hub_contacts (id, primary_email, display_name, phone, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run('con-delay', 'person@example.com', 'Person', '', now, now);
  db.prepare(`INSERT INTO comms_hub_conversations (id, channel, provider, workflow, status, contact_id, subject, source_reference, created_at, updated_at, last_message_at, metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('cnv-delay', 'email', 'one.com', 'email_inbox', 'open', 'con-delay', 'Hello', 'source', now, now, now, '{}');
  for (const actionType of ['reply_draft', 'email_reply', 'form_reply']) {
    assert.doesNotThrow(() => db.prepare(`INSERT INTO comms_hub_delayed_actions (id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts, idempotency_key, next_attempt_at, created_by, created_at, updated_at) VALUES (?,?,?,?,?,'scheduled',0,8,?,?,?, ?, ?)`)
      .run(`delay-${actionType}`, 'cnv-delay', actionType, '{}', now, `key-${actionType}`, now, 'test', now, now));
  }
});


test('social DM human request outside hours offers callback email without implying live availability', async () => {
  const sent = [];
  const notifications = [];
  const event = {
    threadType: 'dm', direction: 'inbound', bodyText: 'Can I speak to Jonathan?',
    conversationId: 'social-dm-1', contactId: 'contact-social-1', platform: 'instagram', messageId: 'social-message-1',
  };
  const conversation = {
    id: event.conversationId, channel: 'social_dm', status: 'open',
    messages: [{ direction: 'inbound', body_text: event.bodyText }],
  };
  const context = {
    now: () => '2026-08-16T18:00:00.000Z',
    config: {
      socialMonitorOnly: false, badLanguageBlockEnabled: true,
      businessTimeZone: 'Europe/London', businessStartHour: 9, businessEndHour: 17,
      callbackEmailCaptureEnabled: true,
    },
    repository: {
      async getConversation() { return conversation; },
      async getSocialThreadByConversation() { return { platform: 'instagram', credential_family: 'meta', thread_type: 'dm', account_id: 'acct-1', provider_thread_id: 'thread-1' }; },
      async claimOutboundAction() { return { acquired: true, duplicate: false }; },
      async completeOutboundAction() {}, async failOutboundAction() {},
    },
    operationsRepository: {
      async getConversationOperations() { return { operational_status: 'open' }; },
      async addContactAlias(alias) { return alias; },
    },
    notificationService: { async create(input) { notifications.push(input); return input; } },
    auditService: { async record() {} },
    zernio: { meta: { async sendMessage(input) { sent.push(input); return { id: 'provider-reply-1' }; } } },
  };
  await handleSocialDmHumanContact(event, context);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].metadata.handoffAvailable, false);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /leave an email address/i);
  assert.doesNotMatch(sent[0].message, /available for hand-off now/i);
});
