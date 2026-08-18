import test from 'node:test';
import assert from 'node:assert/strict';

import { emailValidationScore as filterEmailScore } from '../services/outreach/utils/filters.js';
import { OutreachAutomationService, classifyOutreachReplyText, emailValidationScore } from '../services/outreach/services/automationService.js';
import { aiConfig } from '../services/shared/utils/ai-config.js';
import { COMMS_HUB_REQUIRED_MIGRATIONS } from '../services/comms-hub/migrations/manifest.js';

function service(env = {}) {
  const context = {
    d1: { query: async () => ({ results: [] }), batch: async () => [] },
    config: { badLanguageBlockEnabled: true },
  };
  return new OutreachAutomationService({ context, env, aiRequest: async () => '{"body":"ok"}' });
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
  assert.equal(COMMS_HUB_REQUIRED_MIGRATIONS.at(-1), '0012_excluded_email_automation_scope');
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
