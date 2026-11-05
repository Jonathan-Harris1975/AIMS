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

test('description comparisons decode quotes, numeric entities and typographic characters', async () => {
  const { normaliseDescription, currentKdpPrice } = await import('../services/kdp/metadataValues.js');
  assert.equal(normaliseDescription('<p>A &quot;useful&quot; guide&#39;s scope&nbsp;— AI.</p>'), 'A "useful" guide\'s scope — AI.');
  assert.equal(currentKdpPrice({ prices: { GB: '5.99' } }, 'GBP'), '5.99');
});

test('research invalidated by a manual KDP edit is retired so other proposals can proceed', async () => {
  const value = { ...intent(), proposal: { basis: { description: 'Original', keywords: ['old'] } } };
  let published = false;
  const result = await processOptimisation('key', value, deps({ publish: async () => { published = true; } }));
  assert.equal(result.status, 'conflict');
  assert.equal(value.status, 'conflict');
  assert.equal(published, false);
});

test('a committed D1 change with a lost response reconciles instead of blocking website work', async () => {
  const { updateKdpEbookMetadata } = await import('../services/kdp/catalogue.js');
  let reads = 0;
  const after = { ...book, description: 'New description', keywords: ['new'] };
  const result = await updateKdpEbookMetadata(intent(), {
    readBook: async () => ++reads === 1 ? book : after,
    query: async (sql) => sql.startsWith('SELECT') ? { results: [{ description: book.description, keywords_json: JSON.stringify(book.keywords) }] }
      : { meta: { changes: 0 } },
  });
  assert.equal(result.status, 'already_updated');
});

test('price-only changes wait for the four-week cooldown', async () => {
  const value = { ...intent(), details: {}, prices: { USD: '6.50' } };
  let calls = 0;
  const result = await processOptimisation('key', value, deps({
    sync: async () => ({ ...meta, listPriceUsd: '6.00' }),
    load: async () => ({ priceVerifiedAt: '2026-11-09T12:00:00Z' }),
    publish: async () => { calls++; },
  }));
  assert.equal(result.status, 'price_cooldown');
  assert.equal(calls, 0);
});

test('a slow setup refresh cannot carry submission past the London window', async () => {
  let clock = date, calls = 0;
  const result = await processOptimisation('key', intent(), deps({ now: () => clock,
    sync: async () => { clock = new Date('2026-11-10T15:01:00Z'); return meta; }, publish: async () => { calls++; } }));
  assert.equal(result.status, 'outside_window');
  assert.equal(calls, 0);
});
