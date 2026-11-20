import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { buildRoyaltyFloorPlan, reconcileRoyaltyFloor } from '../services/kdp/royaltyFloorRollout.js';

const titleId = 'A1234567890123';
const asin = 'B012345678';
const book = (props = {}) => ({
  titleId, asin, format: 'kindle', title: 'Example', publishingStatus: 'LIVE',
  royaltyPlan: '70_PERCENT', fileSizeKb: '400', listPriceUsd: '7.12',
  prices: { UK: '4.99', US: '7.12' }, ...props,
});
const snapshot = (books = [book()]) => ({ syncedAt: new Date().toISOString(), books });
const catalogue = () => [{ ebookId: 1, asin, title: 'Example' }];

function parsePricing(selectedRadio, hiddenValue) {
  const file = fs.readFileSync(path.resolve('services/kdp/engine/browser/parseBookPricing.js'), 'utf8');
  const document = {
    body: { innerText: 'ASIN: B012345678' },
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: (selector) => {
      if (selector === 'input[name="data[digital][royalty_rate]-radio"]:checked') {
        return selectedRadio ? { value: selectedRadio } : null;
      }
      if (selector === 'input[type="hidden"][name="data[digital][royalty_rate]"]') {
        return hiddenValue ? { value: hiddenValue } : null;
      }
      if (selector === 'input[name="data[digital][filesize_bytes]"]') {
        return { value: '409600' };
      }
      return null;
    },
  };
  return vm.runInNewContext('(' + file + ')()', { document });
}

test('KDP pricing parser reads the selected 70% radio but never infers 70% from an unselected option', () => {
  assert.equal(parsePricing('70_PERCENT', '').royaltyPlan, '70_PERCENT');
  assert.equal(parsePricing('35_PERCENT', '').royaltyPlan, '35_PERCENT');
  assert.equal(parsePricing('', '').royaltyPlan, '');
  assert.equal(parsePricing('', '70_PERCENT').royaltyPlan, '70_PERCENT');
  assert.equal(parsePricing('', 'invalid').royaltyPlan, '');
});

test('royalty-floor plan matches the complete D1 catalogue and calculates consumer-friendly royalty-safe corrections', () => {
  const plan = buildRoyaltyFloorPlan(snapshot(), catalogue());
  assert.equal(plan.total, 1);
  assert.equal(plan.belowFloor, 1);
  assert.equal(plan.unverifiedPlan, 0);
  assert.equal(plan.rows[0].priceMinor, 499);
  assert.equal(plan.rows[0].floorMinor, 699);
  assert.equal(buildRoyaltyFloorPlan(snapshot([book({ prices: { UK: '6.99' } })]), catalogue()).belowFloor, 0);
  assert.equal(buildRoyaltyFloorPlan(snapshot([book({ royaltyPlan: '' })]), catalogue()).unverifiedPlan, 1);
  assert.throws(() => buildRoyaltyFloorPlan(snapshot(), []), /catalogue/);
  assert.throws(() => buildRoyaltyFloorPlan({ syncedAt: '2026-01-01', books: [book()] }, catalogue()), /stale/);
  assert.throws(() => buildRoyaltyFloorPlan(snapshot([book({ asin: 'B000000000' })]), catalogue()), /matched/);
});

function harness({ current = book(), publishResult = { published: true, errors: [], steps: [] }, nowAt = Date.now() } = {}) {
  const saved = new Map();
  const events = [];
  let currentTime = nowAt;
  const deps = {
    now: () => new Date(currentTime), snapshot: async () => snapshot(),
    catalogue: async () => catalogue(),
    load: async (key) => saved.get(key) || null,
    save: async (key, value) => { saved.set(key, structuredClone(value)); events.push('save:' + key); },
    claim: async () => ({ claimed: true, lease: { backend: 'r2', token: 'test' } }),
    release: async () => {},
    sync: async () => current,
    publish: async (request) => { events.push('publish'); return typeof publishResult === 'function' ? publishResult(request) : publishResult; },
    audit: async () => ({ listings: [{ publicListing: {
      status: 'captured', data: { asin, priceSource: 'kindle_price_element', price: '£6.99' },
    } }] }),
  };
  return { deps, events, saved, advance: (milliseconds) => { currentTime += milliseconds; }, setSync: (bookValue) => { deps.sync = async () => bookValue; } };
}

test('dry run is read-only even with below-floor catalogue prices', async () => {
  const h = harness();
  h.deps.claim = () => { throw new Error('A dry run must not claim the write lease'); };
  const report = await reconcileRoyaltyFloor({ ...h.deps, dryRun: true });
  assert.equal(report.ok, true);
  assert.equal(report.kdpWritesPerformed, false);
  assert.equal(report.belowFloor, 1);
  assert.equal(h.events.length, 0);
});

test('live run saves an exact-title intent before a single UK price submission', async () => {
  const h = harness();
  const report = await reconcileRoyaltyFloor({ ...h.deps, dryRun: false });
  assert.equal(report.kdpWritesPerformed, true);
  assert.equal(report.results[0].status, 'submitted');
  assert.equal(report.results[0].targetMinor, 699);
  assert.ok(h.events.indexOf('save:pricing/royalty-floor/ledger.json') < h.events.indexOf('publish'));
  const ledger = h.saved.get('pricing/royalty-floor/ledger.json');
  assert.equal(ledger.entries[titleId].status, 'submitted');
});

test('unknown royalty selection blocks publication without inventing 70%', async () => {
  const h = harness({ current: book({ royaltyPlan: '' }) });
  const result = await reconcileRoyaltyFloor({ ...h.deps, dryRun: false });
  assert.equal(result.ok, false);
  assert.equal(result.results[0].status, 'blocked');
  assert.ok(!h.events.includes('publish'));
});

test('uncertain submission is never automatically replayed', async () => {
  const h = harness({ publishResult: { published: false, errors: ['button uncertain'], steps: [] } });
  const first = await reconcileRoyaltyFloor({ ...h.deps, dryRun: false });
  assert.equal(first.results[0].status, 'submission_uncertain');
  h.advance(5 * 3600000);
  const next = await reconcileRoyaltyFloor({ ...h.deps, dryRun: false });
  assert.equal(next.results[0].status, 'awaiting_signed_in_price');
  assert.equal(h.events.filter((event) => event === 'publish').length, 1);
});

test('signed-in and public UK price verification completes a submitted correction', async () => {
  const h = harness();
  await reconcileRoyaltyFloor({ ...h.deps, dryRun: false });
  h.advance(5 * 3600000);
  h.setSync(book({ prices: { UK: '6.99' } }));
  const checked = await reconcileRoyaltyFloor({ ...h.deps, dryRun: false });
  assert.equal(checked.results[0].status, 'verified');
  assert.equal(checked.completed, 1);
  assert.equal(h.events.filter((event) => event === 'publish').length, 1);
});

test('royalty preflight passes exact ASIN to signed-in refresh, not a full Bookshelf rescan', async () => {
  const h = harness();
  const calls = [];
  h.deps.sync = async (id, format, expectedAsin) => {
    calls.push([id, format, expectedAsin]);
    return book();
  };
  await reconcileRoyaltyFloor({ ...h.deps, dryRun: false });
  assert.deepEqual(calls, [[titleId, 'kindle', asin]]);
  assert.ok(h.events.includes('publish'));
});

test('browser timeout during read-only royalty preflight is reported and retried without publishing', async () => {
  const h = harness();
  let calls = 0;
  h.deps.sync = async () => {
    calls++;
    const error = new Error('private browser text must not be stored');
    error.name = 'TimeoutError';
    throw error;
  };
  const first = await reconcileRoyaltyFloor({ ...h.deps, dryRun: false });
  assert.equal(first.ok, false);
  assert.equal(first.blocked, 1);
  assert.equal(first.kdpWritesPerformed, false);
  assert.equal(first.results[0].reason, 'signed_in_refresh_failed');
  assert.equal(first.results[0].errorCode, 'TimeoutError');
  assert.equal(h.saved.get('pricing/royalty-floor/ledger.json').entries[titleId].status, 'blocked');
  assert.equal(JSON.stringify(h.saved.get('pricing/royalty-floor/ledger.json')).includes('private browser text'), false);
  const next = await reconcileRoyaltyFloor({ ...h.deps, dryRun: false });
  assert.equal(next.ok, false);
  assert.equal(next.blocked, 1);
  assert.equal(calls, 1);
  assert.ok(!h.events.includes('publish'));
});
