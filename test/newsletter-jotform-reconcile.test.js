import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileNewsletterWebhook, replayNewsletterTest } from '../services/newsletter/jotformReconcile.js';

const input = { baseUrl: 'https://aims.example', formId: '123', apiBaseUrl: 'https://api.example', apiKey: 'private-test-key' };
const canonical = 'https://aims.example/comms-hub/intake/jotform';
const json = content => ({ ok: true, json: async () => content });

test('webhook repair requires a healthy AIMS target before any provider write', async () => {
  const calls = [];
  await assert.rejects(reconcileNewsletterWebhook({ ...input, fetchImpl: async (url, options) => {
    calls.push(options.method); return json({ ok: true, service: 'other-service' });
  } }), { code: 'newsletter_target_not_ready' });
  assert.deepEqual(calls, ['GET']);
  await assert.rejects(reconcileNewsletterWebhook({ ...input, baseUrl: 'https://aims.example/other' }), { code: 'newsletter_target_invalid' });
});

test('webhook repair preserves other hooks and verifies registration after POST', async () => {
  const hooks = { old: 'https://other.example/hook?secret=do-not-print' };
  let writes = 0;
  const result = await reconcileNewsletterWebhook({ ...input, fetchImpl: async (url, options) => {
    if (url.endsWith('/health')) return json({ ok: true, service: 'comms-hub' });
    if (options.method === 'POST') {
      writes += 1; assert.equal(new URLSearchParams(options.body).get('webhookURL'), canonical);
      hooks.new = canonical;
    }
    return json({ responseCode: 200, content: hooks });
  } });
  assert.equal(writes, 1); assert.equal(hooks.old, 'https://other.example/hook?secret=do-not-print');
  assert.deepEqual(result, { ok: true, status: 'registered' });
  assert(!JSON.stringify(result).includes('do-not-print'));
});

test('existing canonical registration is idempotent and needs no write', async () => {
  await assert.doesNotReject(reconcileNewsletterWebhook({ ...input, fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET');
    return url.endsWith('/health') ? json({ ok: true, service: 'comms-hub' }) : json({ responseCode: 200, content: { existing: canonical } });
  } }));
});

test('uncertain provider acceptance is not blindly retried and next invocation reads first', async () => {
  let registered = false; let writes = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/health')) return json({ ok: true, service: 'comms-hub' });
    if (options.method === 'POST') { registered = true; writes += 1; throw new Error('connection lost'); }
    return json({ responseCode: 200, content: registered ? { existing: canonical } : {} });
  };
  await assert.rejects(reconcileNewsletterWebhook({ ...input, fetchImpl }), /connection lost/);
  assert.equal((await reconcileNewsletterWebhook({ ...input, fetchImpl })).status, 'already_registered');
  assert.equal(writes, 1);
});

test('test recovery targets one dated recipient and passes the recipient guard to production intake', async () => {
  const email = 'ops@example.test'; let calls = 0;
  const result = await replayNewsletterTest({ email, date: '2026-10-08', formId: '123',
    submissions: [{ id: '456', created_at: '2026-10-08 12:00:00', email }, { id: '789', created_at: '2026-10-08 13:00:00', email: 'other@example.test' }],
    context: { d1: { query: async () => ({ results: [] }) } }, processSignup: async args => {
      calls += 1; assert.equal(args.expectedEmail, email); assert.equal(args.identifiers.submissionId, '456');
      return { ok: true, status: 'confirmation_sent', token: 'private-token' };
    } });
  assert.equal(calls, 1); assert.deepEqual(result, { ok: true, status: 'confirmation_sent' });
  assert(!JSON.stringify(result).includes(email)); assert(!JSON.stringify(result).includes('private-token'));
});

test('test recovery skips a recorded confirmation and rejects ambiguous or absent matches', async () => {
  const row = { id: '456', created_at: '2026-10-08 12:00:00', email: 'ops@example.test' };
  const args = { email: row.email, date: '2026-10-08', formId: '123', context: { d1: { query: async () => ({ results: [{ id: 'audit' }] }) } },
    processSignup: async () => assert.fail('unexpected send') };
  assert.equal((await replayNewsletterTest({ ...args, submissions: [row] })).status, 'already_processed');
  for (const submissions of [[], [row, row], [{ ...row, created_at: '2026-10-07 12:00:00' }]]) {
    await assert.rejects(replayNewsletterTest({ ...args, submissions }), { code: 'newsletter_test_submission_not_unique' });
  }
});
