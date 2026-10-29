import test from 'node:test';
import assert from 'node:assert/strict';
import { weekendPlan, londonInstant, prepareWeekendNewsletters, sendWeekendNewsletter } from '../services/newsletter/engine/weekend.js';
import { checkIssueDeliveryPolicy } from '../services/newsletter/engine/deliveryPolicy.js';
import { deliverNewsletterIssue, deliverTodaysIssueToSubscriber, issueDeliveryDue } from '../services/newsletter/delivery/aimsDelivery.js';
import { editionDirection } from '../services/newsletter/engine/edition.js';
import { validateDailyOpening } from '../services/newsletter/engine/validators.js';

const missing = () => { const e = new Error('missing'); e.name = 'NoSuchKey'; throw e; };
const sourceItems = [0, 1, 2].map(i => ({ title: `AI source ${i}`, summary: 'Verified agent research.', link: `https://news.test/${i}`,
  publishedAt: '2026-10-29T10:00:00Z', sourceFeed: `feed${i}` }));

test('Friday plans distinct weekend dates, including London DST changes', () => {
  const autumn = weekendPlan(new Date('2026-10-23T10:00:00Z'));
  assert.equal(autumn[0].scheduledAt, '2026-10-24T16:10:00.000Z');
  assert.equal(autumn[1].scheduledAt, '2026-10-25T05:10:00.000Z');
  const spring = weekendPlan(new Date('2027-03-26T10:00:00Z'));
  assert.equal(spring[1].scheduledAt, '2027-03-28T04:10:00.000Z');
  assert.notEqual(autumn[0].sessionId, autumn[1].sessionId);
  assert.throws(() => weekendPlan(new Date('2026-10-31T10:00:00Z')), /Friday/);
});

test('weekend voice instructions differ and weekly framing stays confined to weekend editions', () => {
  assert.match(editionDirection('saturday'), /competing interpretations/i);
  assert.match(editionDirection('sunday'), /philosophical|sarcastic/);
  assert.equal(validateDailyOpening({ edition: 'sunday', openingNoteHtml: "This week's theme is trust." }).pass, true);
  assert.equal(validateDailyOpening({ edition: 'daily', openingNoteHtml: "This week's theme is trust." }).pass, false);
});

test('Friday builds and stores two QA-passed schedules, retries reuse them without regeneration', async () => {
  const objects = new Map(); let builds = 0;
  const deps = {
    read: async (_bucket, key) => objects.has(key) ? objects.get(key) : missing(),
    write: async (_bucket, key, value) => { objects.set(key, JSON.stringify(value)); },
    collect: async () => ({ items: sourceItems }),
    build: async input => {
      builds += 1;
      assert.equal(input.now.toISOString(), '2026-10-30T10:00:00.000Z');
      assert.deepEqual(input.sourceItems, sourceItems);
      assert.match(input.publicationDate, /2026-(10-31|11-01)/);
      return { ok: true, sessionId: input.sessionId, metadata: { qa: { passed: true } } };
    },
  };
  const first = await prepareWeekendNewsletters({ now: new Date('2026-10-30T10:00:00Z') }, deps);
  assert.equal(first.ok, true); assert.equal(builds, 2);
  const second = await prepareWeekendNewsletters({ now: new Date('2026-10-30T12:00:00Z') }, deps);
  assert.equal(second.ok, true); assert.equal(builds, 2);
  assert.equal(objects.size, 2);
});

test('failed QA cannot produce a scheduled weekend issue', async () => {
  let writes = 0;
  const result = await prepareWeekendNewsletters({ now: new Date('2026-10-30T10:00:00Z') }, {
    read: async () => missing(), collect: async () => ({ items: sourceItems }),
    build: async () => ({ ok: false, error: 'QA failed' }), write: async () => { writes += 1; },
  });
  assert.equal(result.ok, false); assert.equal(writes, 0);
});

test('scheduled sends use Friday artefacts, enforce the window and honour duplicate/uncertain delivery holds', async () => {
  const plan = weekendPlan(new Date('2026-10-30T10:00:00Z'))[1];
  const metadata = { edition: 'sunday', scheduledAt: plan.scheduledAt, qa: { passed: true }, subject: 'Sunday reflection' };
  let deliveries = 0, completed = 0, released = 0;
  const deps = {
    read: async (_bucket, key) => key.includes('state/newsletter-weekends') ? JSON.stringify({ version: 1, ...plan })
      : key.endsWith('metadata.json') ? JSON.stringify(metadata) : 'prepared email',
    maintenance: async () => ({ ok: true, busy: false }),
    readiness: async () => ({ ok: true }), claim: async () => ({ claimed: true, lease: {} }),
    deliver: async input => { deliveries += 1; assert.equal(input.buildResult.emailHtml, 'prepared email'); return { ok: true, status: 'dispatched' }; },
    complete: async () => { completed += 1; }, release: async () => { released += 1; },
  };
  const due = new Date(londonInstant(plan.date, '05:10'));
  assert.equal((await sendWeekendNewsletter({ edition: 'sunday', now: due }, deps)).ok, true);
  assert.equal(deliveries, 1); assert.equal(completed, 1);
  assert.equal((await sendWeekendNewsletter({ edition: 'sunday', now: new Date(due.getTime() - 60000) }, deps)).status, 'outside_delivery_window');
  assert.equal((await sendWeekendNewsletter({ edition: 'sunday', now: new Date(londonInstant(plan.date, '06:00')) }, deps)).status, 'outside_delivery_window');
  assert.equal((await sendWeekendNewsletter({ edition: 'saturday', now: due }, deps)).status, 'wrong_delivery_day');
  assert.equal((await sendWeekendNewsletter({ edition: 'sunday', now: due }, {
    ...deps, claim: async () => ({ claimed: false, reason: 'already-completed' }),
  })).status, 'already_dispatched');
  const uncertain = await sendWeekendNewsletter({ edition: 'sunday', now: due }, {
    ...deps, deliver: async () => { throw new Error('SMTP result unknown'); },
  });
  assert.equal(uncertain.status, 'delivery_reconciliation_required'); assert.equal(released, 0);
});

test('Friday-prepared content cannot leak to recipients or new subscribers before its weekend slot', () => {
  const metadata = { scheduledAt: '2026-11-01T05:10:00.000Z' };
  assert.equal(issueDeliveryDue(metadata, new Date('2026-10-30T18:00:00Z')), false);
  assert.equal(issueDeliveryDue(metadata, new Date('2026-11-01T05:09:00Z')), false);
  assert.equal(issueDeliveryDue(metadata, new Date('2026-11-01T05:10:00Z')), true);
  assert.equal(issueDeliveryDue({ scheduledAt: 'invalid' }), false);
});

test('alternate send paths enforce weekend maintenance and closing-time rules', async () => {
  const metadata = { edition: 'sunday', scheduledAt: '2026-11-01T05:10:00.000Z', qa: { passed: true } };
  const busy = async () => ({ ok: true, busy: true });
  const clear = async () => ({ ok: true, busy: false });
  const now = new Date('2026-11-01T05:15:00Z');
  assert.equal((await checkIssueDeliveryPolicy(metadata, now, { maintenance: busy })).status, 'maintenance_not_clear');
  assert.equal((await checkIssueDeliveryPolicy(metadata, new Date('2026-11-01T05:56:00Z'), { maintenance: clear })).status, 'outside_delivery_window');
  const result = await deliverNewsletterIssue({ profile: { id: 'ai-edge' }, sessionId: 'weekend', buildResult: { metadata } }, {
    now, maintenance: busy,
  });
  assert.equal(result.status, 'maintenance_not_clear');
  const subscriber = await deliverTodaysIssueToSubscriber({ subscriberId: 'person', date: now }, {
    d1: {}, mail: {}, findSession: async () => 'weekend', loadIssue: async () => ({ metadata }), maintenance: busy,
  });
  assert.equal(subscriber.status, 'issue_deferred'); assert.equal(subscriber.reason, 'maintenance_not_clear');
});

test('known storage or audience preflight failures remain safe to retry before any SMTP call', async () => {
  let sends = 0;
  const base = { d1: {}, mail: { sendMessage: async () => { sends += 1; } } };
  const options = { profile: { id: 'ai-edge' }, sessionId: 'test', buildResult: { metadata: {} } };
  for (const fault of ['storage', 'audience']) {
    const result = await deliverNewsletterIssue(options, { ...base,
      readDelivery: async () => { if (fault === 'storage') throw new Error('R2 unavailable'); return { delivery: null }; },
      listRecipients: async () => { throw new Error('D1 unavailable'); },
    });
    assert.equal(result.stage, 'preflight'); assert.equal(result.safeToRetry, true);
  }
  assert.equal(sends, 0);
});
