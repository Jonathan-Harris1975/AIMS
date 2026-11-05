import { createHash } from 'node:crypto';
import { getObjectAsText, putPrivateJson, listObjects } from '../shared/utils/r2-client.js';
import { claimDurableLease, releaseDurableLease } from '../shared/utils/durableLease.js';
import { syncBookMetadata } from './engine/kdpMetadata.ts';
import { publishBook } from './engine/kdpPublish.ts';
import { auditPublicCatalogue } from './publicListingAudit.js';
import { getKdpEbookById, updateKdpEbookMetadata } from './catalogue.js';
import { inWeeklyWindow } from './weeklyResearch.js';
import { triggerRebuild } from './pageCountSync.js';
import { purgeCloudflareCache } from '../cloudflare-purge/utils/purgeCloudflareCache.js';
import { parseKdpPriceMinorUnits } from './engine/kdpPriceRules.ts';

function submissionDelayMs() {
  const minutes = Number(process.env.KDP_UPDATE_DELAY_MINUTES || 5);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 180) throw new Error('Invalid KDP_UPDATE_DELAY_MINUTES');
  return minutes * 60000;
}

const PREFIX = 'research/updates/';
const norm = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const missing = (error) => error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
const read = async (key) => { try { return JSON.parse(await getObjectAsText('kdp', key)); } catch (e) { if (missing(e)) return null; throw e; } };
const write = (key, value) => putPrivateJson('kdp', key, value);

export async function queueOptimisation(week, book, proposal, { load = read, save = write } = {}) {
  if (proposal?.status !== 'approved') return { status: 'no_approved_change' };
  const prices = Object.fromEntries(Object.entries(proposal.prices || {}).filter(([, p]) => p.status === 'proposed' && p.priceMinor !== p.previousMinor)
    .map(([m, p]) => [m === 'US' ? 'USD' : 'GBP', (p.priceMinor / 100).toFixed(2)]));
  const details = { ...(proposal.description ? { description: proposal.description } : {}), ...(proposal.keywords?.length ? { keywords: proposal.keywords } : {}) };
  if (!Object.keys(details).length && !Object.keys(prices).length) return { status: 'unchanged' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isSafeInteger(book.ebookId) || !/^B0[A-Z0-9]{8}$/.test(book.asin) || !proposal.titleId) throw new TypeError('Invalid update identity');
  const key = `${PREFIX}${week}/${book.ebookId}.json`;
  const existing = await load(key);
  if (existing) return { status: existing.status, key };
  const intent = { version: 1, week, ebookId: book.ebookId, asin: book.asin, slug: book.slug, titleId: proposal.titleId, status: 'prepared',
    previous: { description: book.description, keywords: book.keywords }, details, prices,
    proposal, createdAt: new Date().toISOString() };
  intent.changeId = createHash('sha256').update(JSON.stringify({ asin: intent.asin, details, prices })).digest('hex');
  await save(key, intent);
  return { status: 'prepared', key };
}

/** Submission uncertainty is never automatically replayed. Verification runs independently of submission windows. */
export async function processOptimisation(key, intent, {
  now = () => new Date(), save = write, load = read, readBook = getKdpEbookById, sync = syncBookMetadata, publish = publishBook,
  audit = auditPublicCatalogue, updateCatalogue = updateKdpEbookMetadata, rebuild = triggerRebuild,
  purge = purgeCloudflareCache, verifyWebsite = websiteMatchesOptimisation,
} = {}) {
  if (['complete', 'conflict', 'expired', 'needs_attention'].includes(intent.status)) return { status: intent.status };
  const persist = async () => { intent.updatedAt = now().toISOString(); await save(key, intent); };
  const book = await readBook(intent.ebookId);
  if (book.asin.toUpperCase() !== intent.asin) { intent.status = 'conflict'; await persist(); return { status: intent.status }; }
  if (intent.status === 'prepared') {
    if (!inWeeklyWindow(now(), 'update')) return { status: 'outside_window' };
    if (+now() - Date.parse(intent.createdAt) > 48 * 3600000) { intent.status = 'expired'; await persist(); return { status: intent.status }; }
    const current = await sync(intent.titleId, 'kindle');
    if (current.asin !== intent.asin || current.titleId !== intent.titleId || current.format !== 'kindle') {
      intent.nextAttemptAt = new Date(+now() + 4 * 3600000).toISOString(); await persist(); return { status: 'identity_unverified' };
    }
    if (!/^live$/i.test(current.publishingStatus || '')) {
      intent.nextAttemptAt = new Date(+now() + 4 * 3600000).toISOString(); await persist(); return { status: 'waiting_for_live_status' };
    }
    const basis = intent.proposal?.basis;
    if (basis && ((intent.details.description && norm(current.description) !== norm(basis.description)) ||
        (intent.details.keywords && JSON.stringify(current.keywords) !== JSON.stringify(basis.keywords)))) return { status: 'kdp_changed_since_research' };
    for (const [currency, value] of Object.entries(intent.prices)) {
      const observed = currency === 'USD' ? current.listPriceUsd : current.prices?.GBP || current.prices?.UK;
      const before = parseKdpPriceMinorUnits(observed || '');
      const after = parseKdpPriceMinorUnits(value);
      if (before === null || before <= 0 || after === null || Math.abs(after - before) / before > 0.25) return { status: 'price_changed_since_research' };
    }
    const history = await load(`research/history/${intent.ebookId}.json`);
    if (Object.keys(intent.prices).length && history?.priceVerifiedAt && +now() - Date.parse(history.priceVerifiedAt) < 28 * 86400000) {
      intent.deferredPrices = intent.prices; intent.prices = {};
      if (!Object.keys(intent.details).length) { intent.status = 'expired'; await persist(); return { status: 'price_cooldown' }; }
    }
    if (!inWeeklyWindow(now(), 'update')) return { status: 'outside_window' };
    // Keep original KDP fields as well as D1 values for the audit trail.
    intent.previousKdp = { description: current.description, keywords: current.keywords, prices: current.prices, listPriceUsd: current.listPriceUsd };
    intent.status = 'submitting'; intent.submissionStartedAt = now().toISOString(); await persist();
    try {
      const result = await publish({ titleId: intent.titleId, format: 'kindle', create: false, dryRun: false, publish: true,
        ...(Object.keys(intent.details).length ? { details: intent.details } : {}),
        ...(Object.keys(intent.prices).length ? { pricing: { prices: intent.prices } } : {}) });
      intent.submission = { published: result.published, errors: result.errors, steps: result.steps };
      intent.nextVerificationAt = new Date(+now() + 4 * 3600000).toISOString();
      intent.status = result.published && !result.errors?.length ? 'submitted' : 'submission_uncertain';
    } catch { intent.status = 'submission_uncertain'; }
    await persist();
    return { status: intent.status };
  }
  if (['submitting', 'submitted', 'submission_uncertain'].includes(intent.status)) {
    // A successful button click is submission evidence, not proof of publication.
    if (intent.nextVerificationAt && +now() < Date.parse(intent.nextVerificationAt)) return { status: 'verification_delayed' };
    if (+now() - Date.parse(intent.submissionStartedAt) > 5 * 86400000) {
      intent.status = 'needs_attention'; await persist(); return { status: intent.status };
    }
    intent.nextVerificationAt = new Date(+now() + 4 * 3600000).toISOString(); await persist();
    const current = await sync(intent.titleId, 'kindle');
    if (current.asin !== intent.asin) return { status: 'identity_unverified' };
    if (!/^live$/i.test(current.publishingStatus || '')) {
      intent.seenNonLive = true; await persist(); return { status: 'awaiting_publication' };
    }
    if (!intent.submission?.published && !intent.seenNonLive && !intent.details.description && !Object.keys(intent.prices).length)
      return { status: 'awaiting_submission_acknowledgement' };
    if (intent.details.description && norm(current.description) !== norm(intent.details.description)) return { status: 'awaiting_metadata' };
    if (intent.details.keywords && JSON.stringify((current.keywords || []).map(norm).filter(Boolean)) !== JSON.stringify(intent.details.keywords.map(norm))) return { status: 'awaiting_keywords' };
    for (const [currency, value] of Object.entries(intent.prices)) {
      const actual = currency === 'USD' ? current.listPriceUsd : current.prices?.GBP || current.prices?.UK;
      if (parseKdpPriceMinorUnits(actual || '') !== parseKdpPriceMinorUnits(value)) return { status: 'awaiting_pricing' };
    }
    for (const marketplace of ['US', 'UK']) {
      const result = await audit([book], { marketplace });
      const row = result.listings?.[0]?.publicListing;
      if (row?.status !== 'captured' || row.data?.asin !== intent.asin) return { status: 'awaiting_public_listing' };
      if (intent.details.description && norm(row.data.description) !== norm(intent.details.description)) return { status: 'awaiting_public_description' };
      const price = intent.prices[marketplace === 'US' ? 'USD' : 'GBP'];
      if (price && (row.data.priceSource !== 'kindle_price_element' ||
        !(marketplace === 'US' ? /^(?:US\s*)?\$/ : /^£/).test(row.data.price || '') ||
        parseKdpPriceMinorUnits(row.data.price) !== parseKdpPriceMinorUnits(price))) return { status: 'awaiting_public_price' };
    }
    intent.status = 'publication_verified'; intent.verifiedAt = now().toISOString(); await persist();
  }
  if (intent.status === 'publication_verified') {
    if (Object.keys(intent.prices).length) await save(`research/history/${intent.ebookId}.json`, { priceVerifiedAt: intent.verifiedAt, prices: intent.prices });
    const result = await updateCatalogue(intent);
    if (result.status === 'conflict') { intent.status = 'conflict'; await persist(); return result; }
    intent.status = 'catalogue_updated'; await persist();
  }
  if (intent.status === 'catalogue_updated') {
    await purge({ files: ['https://jonathan-harris.online/api/v1/ebooks.json'] });
    if (!(await rebuild()).ok) return { status: 'website_rebuild_pending' };
    intent.status = 'website_pending'; intent.rebuildAt = now().toISOString(); await persist();
  }
  if (intent.status === 'website_pending') {
    if (intent.details.description && norm((await readBook(intent.ebookId)).description) !== norm(intent.details.description)) {
      intent.status = 'conflict'; await persist(); return { status: 'conflict' };
    }
    if (await verifyWebsite(intent)) { intent.status = 'complete'; await persist(); }
    else if (+now() - Date.parse(intent.rebuildAt) > 20 * 60000) { intent.status = 'catalogue_updated'; await persist(); }
  }
  return { status: intent.status };
}

export async function websiteMatchesOptimisation(intent, { fetchImpl = fetch } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(intent.slug || '')) return false;
  const response = await fetchImpl(`https://jonathan-harris.online/ebooks/${intent.slug}/?metadata-check=${Date.now()}`, { redirect: 'manual', signal: AbortSignal.timeout(12000),
    headers: { 'cache-control': 'no-cache' } });
  if (!response.ok) return false;
  const html = await response.text();
  // Price and KDP search keywords are retained in the private record; the site
  // is verified for the public description, without assuming a price schema.
  return html.includes(intent.asin) && (!intent.details.description || norm(html).includes(norm(intent.details.description)));
}

export async function runOptimisationUpdates({ now = () => new Date(), list = () => listObjects('kdp', PREFIX), load = read, save = write,
  claim = claimDurableLease, release = releaseDurableLease, process = processOptimisation } = {}) {
  const acquired = await claim({ namespace: 'kdp-research', key: 'weekly-update-worker', pendingTtlMs: 60 * 60000 });
  if (!acquired.claimed) return { ok: true, status: 'already_running' };
  try {
    if (acquired.lease.backend !== 'r2') return { ok: false, status: 'durable_state_not_configured' };
    const controlKey = 'research/update-control.json';
    const control = await load(controlKey) || {};
    const results = [];
    let submittedThisTick = false;
    for (const object of await list()) {
      const intent = await load(object.key);
      if (!intent || ['complete', 'expired'].includes(intent.status)) continue;
      if (['conflict', 'needs_attention'].includes(intent.status)) { results.push({ key: object.key, status: intent.status }); continue; }
      if (intent.nextAttemptAt && +now() < Date.parse(intent.nextAttemptAt)) continue;
      if (intent.status === 'prepared') {
        if (submittedThisTick || !inWeeklyWindow(now(), 'update') || +now() - Date.parse(control.lastSubmissionAt || '1970-01-01') < submissionDelayMs()) continue;
        // Reserve the global delay before a side effect, including failed attempts.
        control.lastSubmissionAt = now().toISOString(); await save(controlKey, control); submittedThisTick = true;
      }
      try { results.push({ key: object.key, ...await process(object.key, intent, { now }) }); }
      catch { results.push({ key: object.key, status: 'retry_pending' }); }
    }
    return { ok: !results.some((r) => ['retry_pending', 'needs_attention', 'conflict', 'submission_uncertain'].includes(r.status)), status: 'processed', results };
  } finally { await release(acquired.lease); }
}
