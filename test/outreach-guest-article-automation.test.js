import test from 'node:test';
import assert from 'node:assert/strict';

import { emailValidationScore as filterEmailScore } from '../services/outreach/utils/filters.js';
import { OutreachAutomationService, classifyOutreachReplyText, emailValidationScore } from '../services/outreach/services/automationService.js';
import { aiConfig } from '../services/shared/utils/ai-config.js';
import { COMMS_HUB_REQUIRED_MIGRATIONS } from '../services/comms-hub/migrations/manifest.js';

function service(env = {}, options = {}) {
  const context = {
    d1: { query: async () => ({ results: [] }), batch: async () => [] },
    config: { badLanguageBlockEnabled: true },
  };
  return new OutreachAutomationService({ context, env, aiRequest: async () => '{"body":"ok"}', ...options });
}

test('ZeroBounce status is translated into a meaningful lead score', () => {
  assert.equal(emailValidationScore({ status: 'valid' }), 1);
  assert.equal(filterEmailScore({ status: 'valid' }), 1);
  assert.equal(emailValidationScore({ status: 'catch-all' }), 0.65);
  assert.equal(emailValidationScore({ status: 'invalid' }), 0);
});

test('recipient eligibility defaults to validated role/business addresses only', () => {
  const s = service({ OUTREACH_ALLOW_NAMED_BUSINESS_CONTACTS: 'false', OUTREACH_ALLOW_CATCH_ALL: 'false' });
  assert.equal(s.recipientEligibility({ domain: 'example.com', email: 'editor@example.com', validation: { status: 'valid' } }).eligible, true);
  assert.equal(s.recipientEligibility({ domain: 'example.com', email: 'jane@example.com', validation: { status: 'valid' }, contact: { type: 'personal' } }).reason, 'named_contact_disabled');
  assert.equal(s.recipientEligibility({ domain: 'example.com', email: 'editor@gmail.com', validation: { status: 'valid' } }).eligible, false);
  assert.equal(s.recipientEligibility({ domain: 'example.com', email: 'editor@example.com', validation: { status: 'invalid' } }).eligible, false);
});

test('initial pitch rechecks suppression at the provider dispatch boundary', async () => {
  const s = service({ OUTREACH_SEND_ENABLED: 'true' }, { now: () => new Date('2026-11-30T09:00:00.000Z') });
  let providerCalls = 0;
  s.repository.createOutboundConversation = async () => ({ conversationId: 'conversation-1' });
  s.repository.isSuppressed = async () => ({ reason: 'opt_out' });
  s.repository.getTargetByEmail = async () => null;
  s.repository.getTargetByDomain = async () => null;
  s.repository.countInitialSendsSince = async () => 0;
  s.context.emailService = { send: async () => { providerCalls += 1; return { providerMessageId: 'msg-1' }; } };
  const lead = { email: 'editor@example.com', domain: 'example.com', validation: { status: 'valid' } };
  await assert.rejects(s.sendInitialPitch({ lead, keyword: 'AI governance', pitch: { subject: 'Pitch', body: 'Body' }, recipientType: 'role' }),
    (error) => error.code === 'OUTREACH_SUPPRESSED');
  assert.equal(providerCalls, 0);
});

test('initial pitch refuses dispatch if send mode is disabled after draft creation', async () => {
  const s = service({ OUTREACH_SEND_ENABLED: 'false' }, { now: () => new Date('2026-11-30T09:00:00.000Z') });
  let providerCalls = 0;
  s.repository.createOutboundConversation = async () => ({ conversationId: 'conversation-1' });
  s.context.emailService = { send: async () => { providerCalls += 1; } };
  const lead = { email: 'editor@example.com', domain: 'example.com', validation: { status: 'valid' } };
  await assert.rejects(s.sendInitialPitch({ lead, keyword: 'AI governance', pitch: { subject: 'Pitch', body: 'Body' }, recipientType: 'role' }),
    (error) => error.code === 'OUTREACH_DISPATCH_DISABLED');
  assert.equal(providerCalls, 0);
});

test('guest article sends fail closed when dispatch flags are absent', async () => {
  const s = service();
  const status = await s.status();
  assert.equal(status.sendEnabled, false);
  assert.equal(status.followUpEnabled, false);
  assert.equal(status.articleAutoSendEnabled, false);
  let providerCalls = 0;
  s.context.emailService = { send: async () => { providerCalls += 1; } };
  await assert.rejects(s.sendThreadReply({ conversation_id: 'conversation-1' }, 'Reply', { idempotencyKey: 'reply-1' }),
    (error) => error.code === 'OUTREACH_DISPATCH_DISABLED');
  assert.equal(providerCalls, 0);
});

test('follow-up settings enforce at least seven days and at most one message', () => {
  const s = service({ OUTREACH_FOLLOW_UP_DAYS: '2', OUTREACH_MAX_FOLLOW_UPS: '3' });
  assert.equal(s.config().followUpDays, 7);
  assert.equal(s.config().maxFollowUps, 1);
});

test('follow-up provider path honours the global send switch', async () => {
  const s = service({ OUTREACH_FOLLOW_UP_ENABLED: 'true' }, { now: () => new Date('2026-11-30T09:00:00.000Z') });
  s.context.d1.query = async () => ({ results: [{ id: 'target-1', email: 'editor@example.com', domain: 'example.com',
    conversation_id: 'conversation-1', state: 'contacted', follow_up_count: 0, last_sent_at: '2026-11-20T09:00:00.000Z' }] });
  let providerCalls = 0;
  s.context.emailService = { send: async () => { providerCalls += 1; } };
  const result = await s.processFollowUp({ targetId: 'target-1' });
  assert.deepEqual(result, { skipped: true, reason: 'dispatch_disabled' });
  assert.equal(providerCalls, 0);
});

test('follow-up is deferred until at least seven full days have elapsed', async () => {
  const s = service({ OUTREACH_SEND_ENABLED: 'true', OUTREACH_FOLLOW_UP_ENABLED: 'true' },
    { now: () => new Date('2026-11-30T09:00:00.000Z') });
  s.context.d1.query = async () => ({ results: [{ id: 'target-1', email: 'editor@example.com', domain: 'example.com',
    conversation_id: 'conversation-1', state: 'contacted', follow_up_count: 0, last_sent_at: '2026-11-24T09:00:00.000Z' }] });
  let providerCalls = 0;
  s.context.emailService = { send: async () => { providerCalls += 1; } };
  const result = await s.processFollowUp({ targetId: 'target-1' });
  assert.equal(result.deferred, true);
  assert.equal(result.reason, 'follow_up_not_due');
  assert.equal(providerCalls, 0);
});

test('follow-up rechecks replies immediately before provider hand-off', async () => {
  const s = service({ OUTREACH_SEND_ENABLED: 'true', OUTREACH_FOLLOW_UP_ENABLED: 'true' },
    { now: () => new Date('2026-11-30T09:00:00.000Z') });
  let reads = 0;
  s.context.d1.query = async () => ({ results: [{ id: 'target-1', email: 'editor@example.com', domain: 'example.com',
    conversation_id: 'conversation-1', state: 'contacted', follow_up_count: 0,
    last_sent_at: '2026-11-23T09:00:00.000Z', last_reply_at: reads++ === 0 ? null : '2026-11-29T14:00:00.000Z' }] });
  s.repository.isSuppressed = async () => null;
  let providerCalls = 0;
  s.context.emailService = { send: async () => { providerCalls += 1; } };
  const result = await s.processFollowUp({ targetId: 'target-1' });
  assert.deepEqual(result, { skipped: true, reason: 'follow_up_not_needed' });
  assert.equal(reads, 2);
  assert.equal(providerCalls, 0);
});

test('follow-up defers to the overlap between authorised sessions and configured business hours', async () => {
  const s = service({ OUTREACH_SEND_ENABLED: 'true', OUTREACH_FOLLOW_UP_ENABLED: 'true' },
    { now: () => new Date('2026-11-30T09:00:00.000Z') });
  s.context.config.businessStartHour = 10;
  s.context.d1.query = async () => ({ results: [{ id: 'target-1', email: 'editor@example.com', domain: 'example.com',
    conversation_id: 'conversation-1', state: 'contacted', follow_up_count: 0,
    last_sent_at: '2026-11-23T09:00:00.000Z' }] });
  let providerCalls = 0;
  s.context.emailService = { send: async () => { providerCalls += 1; } };
  const result = await s.processFollowUp({ targetId: 'target-1' });
  assert.equal(result.deferred, true);
  assert.equal(result.dueAt, '2026-11-30T10:00:00.000Z');
  assert.equal(providerCalls, 0);
});

test('follow-up is blocked when configured business hours do not overlap the authorised session', async () => {
  const s = service({ OUTREACH_SEND_ENABLED: 'true', OUTREACH_FOLLOW_UP_ENABLED: 'true' },
    { now: () => new Date('2026-11-30T09:00:00.000Z') });
  s.context.config.businessStartHour = 11;
  s.context.d1.query = async () => ({ results: [{ id: 'target-1', email: 'editor@example.com', domain: 'example.com',
    conversation_id: 'conversation-1', state: 'contacted', follow_up_count: 0,
    last_sent_at: '2026-11-23T09:00:00.000Z' }] });
  let providerCalls = 0;
  s.context.emailService = { send: async () => { providerCalls += 1; } };
  const result = await s.processFollowUp({ targetId: 'target-1' });
  assert.deepEqual(result, { skipped: true, reason: 'no_authorised_business_hours_overlap' });
  assert.equal(providerCalls, 0);
});

test('deterministic reply routing recognises opt-out, decline, paid placement and article request', () => {
  assert.equal(classifyOutreachReplyText('Please remove me from your list.'), 'opt_out');
  assert.equal(classifyOutreachReplyText('No thanks, this is not a fit.'), 'decline');
  assert.equal(classifyOutreachReplyText('Our guest post fee is £250.'), 'paid_placement');
  assert.equal(classifyOutreachReplyText('Yes, please send the full article.'), 'guidelines_or_article_request');
  assert.equal(classifyOutreachReplyText('Could you send a short outline first?'), 'outline_request');
});

test('outreach premium model routes exist and remain under commsHub privacy routing namespace', () => {
  for (const route of ['commsHubOutreachPitch','commsHubOutreachReply','commsHubOutreachArticle','commsHubOutreachArticleReview']) {
    assert.ok(Array.isArray(aiConfig.routeModels[route]));
    assert.ok(aiConfig.routeModels[route].length >= 1);
  }
});

test('migration manifest includes outreach automation', () => {
  assert.ok(COMMS_HUB_REQUIRED_MIGRATIONS.includes('0009_outreach_automation'));
  assert.ok(COMMS_HUB_REQUIRED_MIGRATIONS.includes('0016_social_conversation_delivery'));
});

test('outreach migration extends delayed actions without dropping earlier action types', async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); } catch { t.skip('node:sqlite unavailable'); return; }
  const fs = await import('node:fs');
  const db = new DatabaseSync(':memory:');
  for (const name of COMMS_HUB_REQUIRED_MIGRATIONS) {
    db.exec(fs.readFileSync(new URL(`../services/comms-hub/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='comms_hub_delayed_actions'").get().sql;
  assert.match(sql, /outreach_follow_up/);
  assert.match(sql, /outreach_reply_process/);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='comms_hub_outreach_targets'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='comms_hub_outreach_articles'").get());
});

test('outreach status reports configured route assignments without independent display defaults', async () => {
  const names = ['OPENROUTER_API_KEY', 'OUTREACH_PITCH_MODEL', 'OUTREACH_ARTICLE_FALLBACK_MODEL'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const savedRoute = aiConfig.routeModels.commsHubOutreachPitch;
  try {
    process.env.OPENROUTER_API_KEY = 'test-only';
    process.env.OUTREACH_PITCH_MODEL = 'test/configured-pitch';
    process.env.OUTREACH_ARTICLE_FALLBACK_MODEL = 'test/configured-fallback';
    aiConfig.routeModels.commsHubOutreachPitch = ['outreachPitch', 'outreachFallback'];
    const status = await service().status();
    assert.equal(status.models.pitch, 'test/configured-pitch');
    assert.deepEqual(status.modelChains.pitch, ['test/configured-pitch', 'test/configured-fallback']);
    assert.equal(status.models.fallback, 'test/configured-fallback');
  } finally {
    aiConfig.routeModels.commsHubOutreachPitch = savedRoute;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
