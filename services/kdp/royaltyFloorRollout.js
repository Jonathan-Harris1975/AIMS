import { getObjectAsText, putPrivateJson } from '../shared/utils/r2-client.js';
import { claimDurableLease, releaseDurableLease } from '../shared/utils/durableLease.js';
import { listKdpEbooks } from './catalogue.js';
import { readKdpMetadataSnapshot } from './storage.js';
import { syncBookMetadata } from './engine/kdpMetadata.ts';
import { publishBook } from './engine/kdpPublish.ts';
import { auditPublicCatalogue } from './publicListingAudit.js';
import { currentKdpPrice } from './metadataValues.js';
import { parseKdpPriceMinorUnits, uk70RoyaltyFloorMinor, uk70RoyaltyPriceRange, validateKdpPriceChanges } from './engine/kdpPriceRules.ts';

const LEDGER_KEY = 'pricing/royalty-floor/ledger.json';
const REPORT_KEY = 'pricing/royalty-floor/latest.json';
const SUBMISSION_GAP_MS = 60 * 60 * 1000;
const VERIFY_GAP_MS = 4 * 60 * 60 * 1000;
const BLOCK_RETRY_GAP_MS = 24 * 60 * 60 * 1000;
const ATTENTION_AFTER_MS = 5 * 24 * 60 * 60 * 1000;
const ASIN = /^B0[A-Z0-9]{8}$/;
const TITLE_ID = /^[A-Z0-9]{10,20}$/;

function validatedMetadataPrice(book) {
  const price = parseKdpPriceMinorUnits(currentKdpPrice(book, 'GBP') || '');
  const priceRange = uk70RoyaltyPriceRange(book.fileSizeKb);
  const floor = priceRange?.minimumMinor ?? uk70RoyaltyFloorMinor(book.fileSizeKb);
  return { price, floor, priceRange };
}

export function buildRoyaltyFloorPlan(snapshot, catalogue) {
  if (!snapshot?.books?.length || !Array.isArray(catalogue) || !catalogue.length) {
    throw new Error('KDP royalty-floor planning requires signed-in metadata and the D1 catalogue.');
  }
  const stamp = Date.parse(snapshot.syncedAt || '');
  if (!Number.isFinite(stamp) || Date.now() - stamp > 8 * 86400000 || stamp > Date.now() + 60000) {
    throw new Error('The signed-in KDP metadata snapshot is stale; refresh it before pricing.');
  }
  const map = new Map();
  for (const row of catalogue) {
    const asin = String(row.asin || '').toUpperCase();
    // New-book drafts can exist in D1 before Amazon assigns an ASIN.
    // Never let an unrelated unpublished draft stop existing-book remediation.
    if (!asin) continue;
    if (!ASIN.test(asin) || map.has(asin)) throw new Error('D1 contains an invalid or duplicate KDP ASIN.');
    map.set(asin, row);
  }
  const titles = new Set();
  const rows = [];
  for (const book of snapshot.books.filter((row) => row.format === 'kindle')) {
    const asin = String(book.asin || '').toUpperCase();
    if (!ASIN.test(asin) || !TITLE_ID.test(String(book.titleId || '')) || titles.has(book.titleId)) {
      throw new Error('KDP snapshot has an ambiguous Kindle title identity.');
    }
    titles.add(book.titleId);
    const catalogueBook = map.get(asin);
    if (!catalogueBook) throw new Error('A KDP Kindle title cannot be matched to the D1 catalogue.');
    const { price, floor, priceRange } = validatedMetadataPrice(book);
    rows.push({
      titleId: book.titleId, asin, ebookId: catalogueBook.ebookId,
      title: catalogueBook.title, priceMinor: price, floorMinor: floor,
      priceRange, fileSizeKb: book.fileSizeKb,
      planVerified: /70/.test(String(book.royaltyPlan || '')),
      live: /^live$/i.test(String(book.publishingStatus || '')),
      needsChange: floor !== null && price !== null && price < floor,
    });
  }
  if (rows.length !== map.size) throw new Error('KDP/D1 Kindle catalogue count mismatch: refusing partial price rollout.');
  return { syncedAt: snapshot.syncedAt, total: rows.length,
    belowFloor: rows.filter((row) => row.needsChange).length,
    unverifiedPlan: rows.filter((row) => !row.planVerified).length,
    missingPriceOrSize: rows.filter((row) => row.priceMinor === null || row.floorMinor === null).length,
    rows };
}

async function defaultLoad(key) {
  try { return JSON.parse(await getObjectAsText('kdp', key)); }
  catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

function confirmedPrice(book, expectedAsin) {
  if (String(book?.asin || '').toUpperCase() !== expectedAsin || book.format !== 'kindle' ||
      !/^live$/i.test(String(book.publishingStatus || ''))) return null;
  const { price, floor } = validatedMetadataPrice(book);
  if (!/70/.test(String(book.royaltyPlan || '')) || price === null || floor === null) return null;
  return { price, floor };
}

export async function reconcileRoyaltyFloor({
  dryRun = true, now = () => new Date(), load = defaultLoad,
  save = (key, record) => putPrivateJson('kdp', key, record),
  snapshot = readKdpMetadataSnapshot, catalogue = listKdpEbooks,
  sync = syncBookMetadata, publish = publishBook, audit = auditPublicCatalogue,
  claim = claimDurableLease, release = releaseDurableLease,
} = {}) {
  const plan = buildRoyaltyFloorPlan(await snapshot(), await catalogue());
  if (dryRun) return { ok: true, dryRun: true, kdpWritesPerformed: false,
    total: plan.total, belowFloor: plan.belowFloor, unverifiedPlan: plan.unverifiedPlan,
    missingPriceOrSize: plan.missingPriceOrSize, syncedAt: plan.syncedAt,
    targets: plan.rows.filter((row) => row.needsChange) };
  const lease = await claim({ namespace: 'kdp-research', key: 'weekly-update-worker', pendingTtlMs: 60 * 60000 });
  if (!lease.claimed) return { ok: true, status: 'already_running', kdpWritesPerformed: false };
  try {
    if (lease.lease.backend !== 'r2') return { ok: false, status: 'durable_state_not_configured', kdpWritesPerformed: false };
    const ledger = await load(LEDGER_KEY) || { version: 1, entries: {}, lastSubmissionAt: null };
    if (ledger.version !== 1 || !ledger.entries || typeof ledger.entries !== 'object') {
      throw new Error('Invalid KDP royalty-floor ledger: refusing to submit.');
    }
    const persist = async () => { ledger.updatedAt = now().toISOString(); await save(LEDGER_KEY, ledger); };
    const results = [];
    let verifications = 0;
    // A timed-out submission is never replayed. Verify its outcome against KDP
    // and the public UK listing before proceeding or raising an operator issue.
    for (const row of plan.rows) {
      const entry = ledger.entries[row.titleId];
      if (!entry || !['submitting', 'submitted', 'submission_uncertain'].includes(entry.status)) continue;
      if (+now() - Date.parse(entry.startedAt) < VERIFY_GAP_MS) continue;
      if (verifications >= 2) break;
      verifications++;
      if (+now() - Date.parse(entry.startedAt) > ATTENTION_AFTER_MS) {
        entry.status = 'needs_attention'; entry.reason = 'publication_not_verified'; await persist();
        results.push({ titleId: row.titleId, status: entry.status }); continue;
      }
      try {
        const current = await sync(row.titleId, 'kindle', row.asin);
        const price = confirmedPrice(current, row.asin);
        if (!price || price.price < price.floor || price.price < entry.targetMinor) {
          results.push({ titleId: row.titleId, status: 'awaiting_signed_in_price' }); continue;
        }
        const book = (await catalogue()).find((item) => item.asin.toUpperCase() === row.asin);
        const listing = (await audit([book], { marketplace: 'UK' }))?.listings?.[0]?.publicListing;
        const visible = listing?.data;
        const actual = parseKdpPriceMinorUnits(visible?.price || '');
        if (listing?.status !== 'captured' || visible?.asin !== row.asin ||
            visible?.priceSource !== 'kindle_price_element' || !/^£/.test(visible?.price || '') ||
            actual === null || actual < price.floor || actual < entry.targetMinor) {
          results.push({ titleId: row.titleId, status: 'awaiting_public_price' }); continue;
        }
        entry.status = 'verified'; entry.verifiedAt = now().toISOString();
        entry.verifiedMinor = actual; await persist();
        results.push({ titleId: row.titleId, status: 'verified' });
      } catch (error) {
        results.push({ titleId: row.titleId, status: 'verification_pending', error: String(error?.message || error) });
      }
    }
    const pending = plan.rows.filter((row) => row.needsChange &&
      !['submitting', 'submitted', 'submission_uncertain', 'needs_attention']
        .includes(ledger.entries[row.titleId]?.status) &&
      (ledger.entries[row.titleId]?.status !== 'verified' ||
        Date.parse(plan.syncedAt) > Date.parse(ledger.entries[row.titleId].verifiedAt || '')) &&
      (!ledger.entries[row.titleId]?.nextAttemptAt ||
        Date.parse(ledger.entries[row.titleId].nextAttemptAt) <= +now()));
    let applied = false;
    let blocked = false;
    if (pending.length && +now() - Date.parse(ledger.lastSubmissionAt || '1970-01-01') >= SUBMISSION_GAP_MS) {
      const row = pending[0];
      let current = null;
      let refreshError = null;
      try { current = await sync(row.titleId, 'kindle', row.asin); }
      catch (error) { refreshError = error; }
      const price = current ? confirmedPrice(current, row.asin) : null;
      if (refreshError) {
        // A read-only preflight failed before KDP side effects. Persist an
        // explicit bounded retry instead of losing the entire scheduled run.
        const errorCode = String(refreshError.code || refreshError.name || 'unknown')
          .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
        ledger.entries[row.titleId] = { status: 'blocked', reason: 'signed_in_refresh_failed',
          errorCode, nextAttemptAt: new Date(+now() + BLOCK_RETRY_GAP_MS).toISOString() };
        blocked = true;
        await persist();
        results.push({ titleId: row.titleId, status: 'blocked',
          reason: 'signed_in_refresh_failed', errorCode });
      } else if (!price || price.price === null || !Number.isSafeInteger(price.floor)) {
        ledger.entries[row.titleId] = { status: 'blocked', reason: 'current_identity_plan_or_price_unverifiable',
          nextAttemptAt: new Date(+now() + BLOCK_RETRY_GAP_MS).toISOString() };
        blocked = true; await persist();
        results.push({ titleId: row.titleId, status: 'blocked', reason: ledger.entries[row.titleId].reason });
      } else if (price.price >= price.floor) {
        ledger.entries[row.titleId] = { status: 'verified', verifiedAt: now().toISOString(),
          verifiedMinor: price.price, reason: 'already_at_floor' };
        await persist();
        results.push({ titleId: row.titleId, status: 'verified_without_change' });
      } else {
        const errors = validateKdpPriceChanges('kindle',
          { prices: { GBP: (price.floor / 100).toFixed(2) } }, current.royaltyPlan, current.fileSizeKb);
        if (errors.length || price.floor > 1299) {
          ledger.entries[row.titleId] = { status: 'needs_attention', reason: 'price_policy_invalid', errors };
          await persist(); blocked = true;
          results.push({ titleId: row.titleId, status: 'needs_attention', errors });
        } else {
          // Persist before the first KDP side effect. If interrupted, reconciliation
          // checks publication but will not double-submit a possibly successful write.
          ledger.entries[row.titleId] = { status: 'submitting', asin: row.asin, previousMinor: price.price,
            targetMinor: price.floor, startedAt: now().toISOString() };
          ledger.lastSubmissionAt = now().toISOString();
          await persist();
          try {
            const outcome = await publish({ titleId: row.titleId, format: 'kindle', create: false,
              dryRun: false, publish: true, pricing: { prices: { GBP: (price.floor / 100).toFixed(2) } } });
            ledger.entries[row.titleId].status = outcome.published && !outcome.errors?.length
              ? 'submitted' : 'submission_uncertain';
            ledger.entries[row.titleId].steps = outcome.steps?.map((step) => ({
              step: step.step, success: step.success, errors: step.errors }));
            ledger.entries[row.titleId].errors = outcome.errors || [];
          } catch (error) {
            ledger.entries[row.titleId].status = 'submission_uncertain';
            ledger.entries[row.titleId].errors = [String(error?.message || error)];
          }
          await persist(); applied = true;
          results.push({ titleId: row.titleId, status: ledger.entries[row.titleId].status,
            targetMinor: price.floor });
        }
      }
    }
    const report = { ok: !blocked && !results.some((r) =>
      ['needs_attention', 'submission_uncertain', 'verification_pending'].includes(r.status)),
      dryRun: false, kdpWritesPerformed: applied, total: plan.total,
      belowFloorAtSnapshot: plan.belowFloor, unverifiedPlanAtSnapshot: plan.unverifiedPlan,
      completed: Object.values(ledger.entries).filter((entry) => entry.status === 'verified').length,
      submitted: Object.values(ledger.entries).filter((entry) => ['submitted','submitting','submission_uncertain'].includes(entry.status)).length,
      results, checkedAt: now().toISOString() };
    await save(REPORT_KEY, report);
    return report;
  } finally { await release(lease.lease); }
}
