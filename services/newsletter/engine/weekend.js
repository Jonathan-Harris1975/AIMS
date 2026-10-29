import { checkWeekendMaintenance } from "./weekendMaintenance.js";
import { buildNewsletter } from './buildNewsletter.js';
import { getNewsletterProfile } from '../config/profiles.js';
import { getObjectAsText, putJson } from '../../shared/utils/r2-client.js';
import { qaFingerprint } from '../../shared/utils/validatedResultCache.js';
import { claimDurableLease, completeDurableLease, releaseDurableLease } from '../../shared/utils/durableLease.js';
import { deliverNewsletterIssue, getNewsletterDeliveryReadiness } from '../delivery/aimsDelivery.js';
import { buildIssueKeyPrefix } from './storage.js';
import { collectCandidateStories } from './rss.js';

export const WEEKEND_TIMES = Object.freeze({ saturday: '17:10', sunday: '05:10' });
const CUTOFF_TIMES = Object.freeze({ saturday: '17:55', sunday: '05:55' });
const DAY_MS = 86400000;
export function londonDate(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function londonInstant(day, time) {
  const target = new Date(`${day}T${time}:00Z`).getTime();
  let instant = target;
  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
    instant += target - local;
  }
  return new Date(instant).toISOString();
}
export function weekendPlan(now = new Date()) {
  const friday = londonDate(now);
  const anchor = new Date(`${friday}T12:00:00Z`);
  if (anchor.getUTCDay() !== 5) throw new Error('Weekend editions must be prepared on Friday (Europe/London).');
  return ['saturday', 'sunday'].map((edition, index) => {
    const date = new Date(anchor.getTime() + (index + 1) * DAY_MS).toISOString().slice(0, 10);
    return { edition, date, preparedOn: friday, sessionId: `NL-ai-edge-${edition}-${date}`,
      scheduledAt: londonInstant(date, WEEKEND_TIMES[edition]), cutoffAt: londonInstant(date, CUTOFF_TIMES[edition]) };
  });
}
function keyFor(date) { return `state/newsletter-weekends/ai-edge/${date}.json`; }
function missing(error) { return error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404; }
async function readPlan(date, read) {
  try {
    const plan = JSON.parse(await read('metasystem', keyFor(date)));
    if (plan?.version !== 1 || plan.date !== date || !['saturday', 'sunday'].includes(plan.edition) || !plan.sessionId) {
      throw new Error('Invalid stored weekend newsletter schedule.');
    }
    return plan;
  } catch (error) { if (missing(error)) return null; throw error; }
}
export async function collectWeekSources(profile, now, { read = getObjectAsText, collect = collectCandidateStories } = {}) {
  const friday = new Date(`${londonDate(now)}T12:00:00Z`);
  const sources = new Map();
  // Use the actual approved weekday selections, preserving original source summaries.
  for (let offset = 4; offset >= 0; offset -= 1) {
    const day = new Date(friday.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
    let record;
    try { record = JSON.parse(await read('metasystem', `state/newsletter-builds/${day}/${qaFingerprint(profile.id)}.json`)); }
    catch (error) { if (missing(error)) continue; throw error; }
    if (record.day !== day || !record.qaResult?.ok || record.qaResult.quarantined) continue;
    const issue = record.qaResult.newsletter;
    const used = new Set([...(issue.bigThree || []), issue.worthUsing, ...(issue.onRadar || [])].filter(Boolean).map(s => s.link));
    for (const source of [record.lead, ...(record.stories || [])]) {
      if (source?.title && source?.link && used.has(source.link)) sources.set(source.link, source);
    }
  }
  // Bootstrap a first week where weekday checkpoints are unavailable, using only this week's evidence.
  if (sources.size < 3) {
    const { items } = await collect(profile, { now, windowHours: 120 });
    const monday = new Date(friday.getTime() - 4 * DAY_MS).toISOString().slice(0, 10);
    const cutoff = Date.parse(londonInstant(monday, '00:00'));
    for (const source of items) {
      const published = Date.parse(source.publishedAt);
      if (published >= cutoff && published <= now.getTime()) sources.set(source.link, source);
    }
  }
  if (sources.size < 3) throw new Error('Not enough verified weekday sources to prepare the weekend editions.');
  return [...sources.values()];
}
export async function prepareWeekendNewsletters({ now = new Date() } = {}, deps = {}) {
  const read = deps.read || getObjectAsText, write = deps.write || putJson;
  const plans = weekendPlan(now), profile = getNewsletterProfile('ai-edge');
  const existingPlans = await Promise.all(plans.map(plan => readPlan(plan.date, read)));
  if (existingPlans.every(Boolean)) return { ok: true, status: 'weekend_scheduled', editions: existingPlans.map(plan => ({ ...plan, reused: true })) };
  const sources = await collectWeekSources(profile, now, { read, collect: deps.collect || collectCandidateStories });
  const results = [];
  for (const plan of plans) {
    const existing = await readPlan(plan.date, read);
    if (existing) { results.push({ ok: true, ...existing, reused: true }); continue; }
    const built = await (deps.build || buildNewsletter)({ profileId: profile.id, edition: plan.edition, publicationDate: plan.date,
      scheduledAt: plan.scheduledAt, sourceItems: sources, sessionId: plan.sessionId, now });
    if (!built?.ok || built.metadata?.qa?.passed !== true) {
      results.push({ ok: false, edition: plan.edition, error: built?.error || 'Weekend issue did not pass QA.' });
      continue;
    }
    const saved = { version: 1, ...plan, sessionId: built.sessionId, status: 'scheduled', createdAt: now.toISOString() };
    await write('metasystem', keyFor(plan.date), saved);
    results.push({ ok: true, ...saved });
  }
  return { ok: results.every(r => r.ok), status: results.every(r => r.ok) ? 'weekend_scheduled' : 'preparation_failed', editions: results };
}
export async function sendWeekendNewsletter({ edition, now = new Date() }, deps = {}) {
  if (!['saturday', 'sunday'].includes(edition)) throw new Error('Invalid weekend edition.');
  const date = londonDate(now), weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday !== (edition === 'saturday' ? 6 : 0)) return { ok: false, status: 'wrong_delivery_day' };
  const start = Date.parse(londonInstant(date, WEEKEND_TIMES[edition]));
  const end = Date.parse(londonInstant(date, CUTOFF_TIMES[edition]));
  if (now.getTime() < start || now.getTime() >= end) return { ok: false, status: 'outside_delivery_window' };
  const read = deps.read || getObjectAsText;
  const plan = await readPlan(date, read);
  if (!plan || plan.edition !== edition || plan.scheduledAt !== new Date(start).toISOString()) {
    return { ok: false, status: 'friday_issue_not_prepared' };
  }
  const profile = getNewsletterProfile('ai-edge'), storageDate = new Date(`${date}T12:00:00Z`);
  const prefix = buildIssueKeyPrefix(profile, { date: storageDate, sessionId: plan.sessionId });
  const metadata = JSON.parse(await read(profile.storage.htmlBucketKey, `${prefix}/metadata.json`));
  if (!metadata.qa?.passed || metadata.edition !== edition || metadata.scheduledAt !== plan.scheduledAt) {
    return { ok: false, status: 'prepared_issue_invalid' };
  }
  const [emailHtml, plaintext] = await Promise.all([
    read(profile.storage.htmlBucketKey, `${prefix}/email.html`), read(profile.storage.htmlBucketKey, `${prefix}/index.txt`),
  ]);
  const maintenance = await (deps.maintenance || checkWeekendMaintenance)({ now });
  if (!maintenance.ok || maintenance.busy) return { ok: false, status: "maintenance_not_clear", maintenance };
  const ready = await (deps.readiness || getNewsletterDeliveryReadiness)({ profile });
  if (!ready.ok) return { ok: false, status: 'delivery_not_ready', readiness: ready };
  const claim = await (deps.claim || claimDurableLease)({ namespace: 'newsletter-weekend-send', key: `${edition}:${date}`,
    pendingTtlMs: 60 * 60000, completedTtlMs: 7 * DAY_MS });
  if (!claim.claimed) return { ok: claim.reason === 'already-completed', status: claim.reason === 'already-completed' ? 'already_dispatched' : 'delivery_in_progress' };
  try {
    const result = await (deps.deliver || deliverNewsletterIssue)({ profile, sessionId: plan.sessionId, date: storageDate,
      buildResult: { metadata, newsletter: { subject: metadata.subject, previewText: metadata.previewText }, emailHtml, plaintext } });
    if (result.ok) await (deps.complete || completeDurableLease)(claim.lease, result);
    else if (result.status !== 'delivery_reconciliation_required') await (deps.release || releaseDurableLease)(claim.lease, result);
    return result;
  } catch (error) {
    // Keep an ambiguous delivery lease pending; never replay it automatically within the send window.
    return { ok: false, status: 'delivery_reconciliation_required', error: error.message };
  }
}
