import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearchTick, runResearchBatch, researchFailureDetail } from '../services/kdp/researchWorker.js';

const date = new Date('2026-11-17T12:05:00Z');
const env = {
  TAVILY_SEARCH_API: 'test',
  R2_ENDPOINT: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test',
  R2_BUCKET_META_SYSTEM: 'test', KDP_RESEARCH_BATCH_SIZE: '1',
};
const audit = { mode: 'public', ok: true, complete: true, runId: 'audit-1',
  createdAt: '2026-11-16T12:00:00Z', completedAt: '2026-11-16T12:05:00Z' };
const book = { ebookId: 1, asin: 'B012345678', title: 'A useful guide' };

function setup(overrides = {}) {
  let saved = null;
  const events = [];
  const options = {
    now: () => date, env,
    claim: async () => ({ claimed: true, lease: { backend: 'r2', token: 'test' } }),
    release: async () => { events.push('released'); },
    getAudit: async () => audit, getBooks: async () => [book],
    getMetadata: async () => null,
    readState: async () => saved && structuredClone(saved),
    writeState: async (state) => { saved = structuredClone(state); },
    archive: async () => {},
    discover: async (b) => ({ ebookId: b.ebookId, competitors: { US: [], UK: [] } }),
    captureEvidence: async () => ({ markets: { US: { status: 'no_candidates' },
      UK: { status: 'no_candidates' } } }),
    draft: async () => ({ status: 'approved', titleId: 'A123456789012',
      keywords: ['research phrase'], prices: {}, description: null }),
    queueUpdate: async () => ({ status: 'prepared' }),
    updateTick: async () => { events.push('updateTick'); return { ok: true, status: 'processed' }; },
    ...overrides,
  };
  return { options, events, state: () => saved };
}

test('approved optimisation is dispatched in the same permitted window, not stranded overnight', async () => {
  const h = setup();
  const result = await runResearchTick(h.options);
  assert.equal(result.status, 'complete');
  assert.equal(h.state().results[0].update.status, 'prepared');
  assert.equal(h.state().results[0].updateDispatch.ok, true);
  assert.equal(h.events.filter((e) => e === 'updateTick').length, 2);
  assert.equal(h.state().cursor, 1);
});

test('provider failure retries the same book once, then records technical failure and fails the batch', async () => {
  let calls = 0;
  const h = setup({ draft: async () => {
    calls++;
    const error = new Error('private provider message is not for a report');
    error.code = 'KDP_RESEARCH_INFERENCE_UNAVAILABLE';
    error.freeFailure = 'AIEmptyCompletionError';
    error.paidFailure = 'OPENROUTER_TIMEOUT';
    throw error;
  } });
  const first = await runResearchTick(h.options);
  assert.equal(first.status, 'pending');
  assert.equal(first.technicalRetryScheduled, true);
  assert.equal(h.state().cursor, 0);
  assert.equal(h.state().pending.length, 1);
  const second = await runResearchTick(h.options);
  assert.equal(second.status, 'complete');
  assert.equal(second.technicalFailures, 1);
  assert.equal(calls, 2);
  assert.equal(h.state().results[0].optimisation.failure.freeFailure, 'AIEmptyCompletionError');
  assert.equal(h.state().results[0].optimisation.failure.paidFailure, 'OPENROUTER_TIMEOUT');
  assert.equal(JSON.stringify(h.state()).includes('private provider message'), false);
  assert.equal((await runResearchBatch({ tick: async () => second })).ok, false);
});

test('missing audit, exhausted search budget and blocked storefronts are not reported as successes', async () => {
  for (const status of ['monday_audit_unavailable', 'research_monthly_limit', 'amazon_blocked', 'search_not_configured']) {
    const result = await runResearchBatch({ tick: async () => ({ status }) });
    assert.equal(result.ok, false, status);
  }
  assert.equal((await runResearchBatch({ tick: async () => ({
    status: 'already_complete', technicalFailures: 0 }) })).ok, true);
});

test('pre-existing research conclusions remain unchanged if the drafter finds no supported update', async () => {
  const h = setup({ draft: async () => ({ status: 'blocked', reason: 'insufficient_content_or_dated_sources' }),
    queueUpdate: async () => { throw new Error('no queue should be created'); } });
  const result = await runResearchTick(h.options);
  assert.equal(result.technicalFailures, 0);
  assert.equal(result.proposalCounts.blocked, 1);
  assert.equal(h.state().results[0].optimisation.reason, 'insufficient_content_or_dated_sources');
});

test('failure records sanitise provider error metadata, never store raw bodies', () => {
  const error = new Error('secret body');
  error.code = 'bad model<>/error';
  error.statusCode = 429;
  assert.deepEqual(researchFailureDetail(error, 'proposal'), {
    stage: 'proposal', code: 'badmodelerror', httpStatus: 429,
  });
});
