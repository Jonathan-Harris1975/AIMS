import test from 'node:test';
import assert from 'node:assert/strict';
import { processOptimisation, queueOptimisation, runOptimisationUpdates } from '../services/kdp/optimisationUpdates.js';
const date = new Date('2026-11-10T12:00:00Z');
const book = { ebookId: 1, asin: 'B012345678', slug: 'test', description: 'Old description', keywords: ['old'] };
const proposal = { status: 'approved', titleId: 'A123', description: 'New description', keywords: ['new'], prices: {} };
const intent = () => ({ ...book, titleId: 'A123', status: 'prepared', createdAt: date.toISOString(),
  previous: { description: book.description, keywords: book.keywords }, details: { description: 'New description', keywords: ['new'] }, prices: {} });
const meta = { titleId: 'A123', format: 'kindle', asin: book.asin, publishingStatus: 'Live', description: 'New description', keywords: ['new'] };
function deps(extra = {}) { return { now: () => date, save: async () => {}, load: async () => null,
  readBook: async () => ({ ...book, description: 'New description' }), sync: async () => meta, ...extra }; }

test('queue writes an intent before side effects and preserves an existing submission', async () => {
  let stored;
  const options = { load: async () => stored, save: async (_key, value) => { stored = structuredClone(value); } };
  assert.equal((await queueOptimisation('2026-11-09', book, proposal, options)).status, 'prepared');
  stored.status = 'submitted';
  assert.equal((await queueOptimisation('2026-11-09', book, proposal, options)).status, 'submitted');
  assert.equal(stored.previous.description, book.description);
});

test('no publish after identity mismatch, in-review status or intent persistence failure', async () => {
  let calls = 0;
  const publish = async () => { calls++; };
  assert.equal((await processOptimisation('key', intent(), deps({ publish, sync: async () => ({ ...meta, asin: 'B099999999' }) }))).status, 'identity_unverified');
  assert.equal((await processOptimisation('key', intent(), deps({ publish, sync: async () => ({ ...meta, publishingStatus: 'In Review' }) }))).status, 'waiting_for_live_status');
  await assert.rejects(processOptimisation('key', intent(), deps({ publish, save: async () => { throw Error('storage failed'); } })), /storage failed/);
  assert.equal(calls, 0);
});

test('timed-out submission is persisted and never blindly replayed', async () => {
  const value = intent(); let calls = 0;
  const options = deps({ publish: async () => { calls++; throw Error('timeout'); }, audit: async () => ({ listings: [] }) });
  assert.equal((await processOptimisation('key', value, options)).status, 'submission_uncertain');
  assert.equal((await processOptimisation('key', value, options)).status, 'awaiting_public_listing');
  assert.equal(calls, 1);
});

test('only verified KDP keywords AND live public description permit D1 and website updates', async () => {
  const value = { ...intent(), status: 'submitted', submissionStartedAt: date.toISOString() };
  let writes = 0;
  const options = deps({ updateCatalogue: async () => { writes++; return { status: 'updated' }; },
    audit: async () => ({ listings: [{ publicListing: { status: 'captured', data: { asin: book.asin, description: 'New description' } } }] }),
    purge: async () => {}, rebuild: async () => ({ ok: true }), verifyWebsite: async () => true });
  assert.equal((await processOptimisation('key', value, { ...options, sync: async () => ({ ...meta, keywords: ['wrong'] }) })).status, 'awaiting_keywords');
  assert.equal(writes, 0);
  delete value.nextVerificationAt;
  assert.equal((await processOptimisation('key', value, options)).status, 'complete');
  assert.equal(writes, 1);
});

test('submissions observe window and expiry, verification can run outside the window', async () => {
  assert.equal((await processOptimisation('key', intent(), deps({ now: () => new Date('2026-11-10T15:00:00Z') }))).status, 'outside_window');
  assert.equal((await processOptimisation('key', intent(), deps({ now: () => new Date('2026-11-17T12:00:00Z') }))).status, 'expired');
});

test('global delay allows one prepared submission per tick and persists before processing', async () => {
  const events = [];
  const result = await runOptimisationUpdates({ now: () => date,
    claim: async () => ({ claimed: true, lease: { backend: 'r2' } }), release: async () => {},
    load: async (key) => key.includes('control') ? null : intent(), list: async () => [{ key: 'one' }, { key: 'two' }],
    save: async () => events.push('reserved'), process: async () => { events.push('submitted'); return { status: 'submitted' }; } });
  assert.deepEqual(events, ['reserved', 'submitted']);
  assert.equal(result.results.length, 1);
});


test('keyword-only uncertain submissions cannot be confirmed from saved draft fields alone', async () => {
  const value = { ...intent(), details: { keywords: ['new'] }, status: 'submission_uncertain', submissionStartedAt: date.toISOString() };
  const result = await processOptimisation('key', value, deps());
  assert.equal(result.status, 'awaiting_submission_acknowledgement');
});
