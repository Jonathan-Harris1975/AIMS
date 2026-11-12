import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { COMMS_HUB_REQUIRED_MIGRATIONS } from '../services/comms-hub/migrations/manifest.js';
import { CommsOperationsRepository } from '../services/comms-hub/repositories/commsOperationsRepository.js';
import { CommsHousekeepingRepository } from '../services/comms-hub/repositories/commsHousekeepingRepository.js';
import { CommsHubQuarantineService } from '../services/comms-hub/quarantineService.js';
import { requestGroundedDraft } from '../services/comms-hub/aiWorkflowService.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const migration of COMMS_HUB_REQUIRED_MIGRATIONS) db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}.sql`, import.meta.url), 'utf8'));
  const d1 = {
    query(sql, params = []) { return { results: db.prepare(sql).all(...params) }; },
    batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const output = statements.map(({ sql, params }) => this.query(sql, params));
        db.exec('COMMIT');
        return output;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const operations = new CommsOperationsRepository(d1);
  const housekeeping = new CommsHousekeepingRepository(d1);
  const service = new CommsHubQuarantineService({ context: { operationsRepository: operations } });
  service.register('delayed_action', () => {});
  async function seed(id, status, { uncertain = false, recent = false } = {}) {
    const at = recent ? '2026-11-12T00:00:00.000Z' : '2026-10-19T00:00:00.000Z';
    if (status) {
      await operations.scheduleDelayedAction({ id, actionType: 'recheck', payload: {}, dueAt: at, idempotencyKey: id, actor: 'test', createdAt: at });
      db.prepare('UPDATE comms_hub_delayed_actions SET status = ?, failure_class = ? WHERE id = ?').run(status, uncertain ? 'uncertain' : 'recoverable', id);
    }
    await operations.upsertQuarantineItem({ id: `q-${id}`, sourceType: 'delayed_action', sourceId: id,
      failureClass: 'recoverable', errorMessage: 'failure', attempts: 8, idempotencyKey: `q-${id}`, createdAt: at });
  }
  return { db, d1, operations, housekeeping, service, seed };
}

const at = '2026-11-16T08:00:00.000Z';
const orphanBefore = '2026-11-09T08:00:00.000Z';

test('tidy previews without mutations, clears only terminal or old unlinked orphans, and is idempotent', async (t) => {
  const { seed, housekeeping, db } = fixture(t);
  for (const status of ['complete', 'cancelled', 'scheduled', 'leased', 'quarantined', 'failed']) await seed(status, status);
  await seed('old-orphan', null);
  await seed('new-orphan', null, { recent: true });
  await seed('uncertain', 'complete', { uncertain: true });
  const preview = await housekeeping.tidyQuarantine({ actor: 'tidy', at, orphanBefore, dryRun: true });
  assert.equal(preview.candidates, 3);
  assert.equal(preview.cleared, 0);
  assert.equal(preview.retained, 9);
  const result = await housekeeping.tidyQuarantine({ actor: 'tidy', at, orphanBefore });
  assert.equal(result.cleared, 3);
  assert.equal(result.retained, 6);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comms_hub_quarantine_attempts').get().n, 3);
  assert.equal((await housekeeping.tidyQuarantine({ actor: 'tidy', at, orphanBefore })).cleared, 0);
});

test('resolve and dismiss cancel queued work atomically, refuse running and uncertain work, and preserve reasons', async (t) => {
  const { seed, housekeeping, db } = fixture(t);
  for (const status of ['scheduled', 'failed', 'quarantined', 'leased']) await seed(status, status);
  await seed('uncertain', 'quarantined', { uncertain: true });
  for (const id of ['scheduled', 'failed', 'quarantined']) {
    const result = await housekeeping.resolveQuarantine({ id: `q-${id}`, disposition: 'dismissed', actor: 'admin', reason: 'Handled manually', at });
    assert.equal(result.metadata.resolutionReason, 'Handled manually');
    assert.equal(db.prepare('SELECT status FROM comms_hub_delayed_actions WHERE id = ?').get(id).status, 'cancelled');
  }
  for (const id of ['leased', 'uncertain']) await assert.rejects(
    housekeeping.resolveQuarantine({ id: `q-${id}`, disposition: 'resolved', actor: 'admin', reason: 'test', at }), { code: 'quarantine_not_resolvable' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comms_hub_quarantine_attempts').get().n, 3);
});

test('resolution rolls back if its audit attempt cannot be saved', async (t) => {
  const { seed, housekeeping, db } = fixture(t);
  await seed('rollback', 'scheduled');
  db.exec("CREATE TRIGGER reject_attempt BEFORE INSERT ON comms_hub_quarantine_attempts BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;");
  await assert.rejects(housekeeping.resolveQuarantine({ id: 'q-rollback', disposition: 'dismissed', actor: 'admin', reason: 'test', at }));
  assert.equal(db.prepare("SELECT status FROM comms_hub_quarantine_items WHERE id = 'q-rollback'").get().status, 'quarantined');
  assert.equal(db.prepare("SELECT status FROM comms_hub_delayed_actions WHERE id = 'rollback'").get().status, 'scheduled');
});

test('replay eligibility follows live source state; atomic claim and quarantine gate prevent competing replays', async (t) => {
  const { seed, service, operations } = fixture(t);
  await seed('missing', null);
  await seed('scheduled', 'scheduled');
  await seed('ready', 'quarantined');
  const items = await service.list({ status: 'active' });
  assert.equal(items.find((q) => q.source_id === 'missing').replayAllowed, false);
  assert.equal(items.find((q) => q.source_id === 'scheduled').replayAllowed, false);
  assert.equal(items.find((q) => q.source_id === 'ready').replayAllowed, true);
  await operations.beginQuarantineReplay({ id: 'q-ready', actor: 'admin' });
  await assert.rejects(operations.beginQuarantineReplay({ id: 'q-ready', actor: 'admin' }), { code: 'quarantine_not_replayable' });
  const input = { id: 'ready', workerId: 'worker-a', now: at, leaseExpiresAt: '2026-11-16T08:03:00.000Z' };
  assert.equal((await operations.claimDelayedActionForReplay(input)).status, 'leased');
  assert.equal(await operations.claimDelayedActionForReplay({ ...input, workerId: 'worker-b' }), null);
  assert.equal(await operations.claimDelayedAction({ workerId: 'worker-c', now: at, leaseExpiresAt: input.leaseExpiresAt }).then((row) => row?.id), 'scheduled');
});

test('purge retains unresolved records and terminal-looking records with active sources', async (t) => {
  const { seed, housekeeping, db } = fixture(t);
  await seed('active', 'scheduled');
  await seed('done', 'complete');
  await seed('open', 'quarantined');
  db.exec("UPDATE comms_hub_quarantine_items SET status = 'resolved' WHERE id IN ('q-active','q-done')");
  const input = { recordCutoff: at };
  assert.equal((await housekeeping.previewQuarantinePurge(input)).items, 1);
  assert.equal((await housekeeping.purgeQuarantineHistory(input)).items, 1);
  assert.deepEqual(db.prepare('SELECT id FROM comms_hub_quarantine_items ORDER BY id').all().map((q) => q.id), ['q-active', 'q-open']);
});

test('invalid citation repair uses one extra call on the same route and still rejects fabricated evidence', async () => {
  const payload = { conversationId: 'test', evidence: [{ sourceReference: 'approved/source' }] };
  for (const succeeds of [true, false]) {
    const calls = [];
    const request = async (route, options) => {
      calls.push({ route, options });
      return { content: JSON.stringify({ bodyText: 'Supported reply', evidenceSourceReferences: [calls.length === 2 && succeeds ? 'approved/source' : 'invented/source'] }) };
    };
    const run = requestGroundedDraft(request, 'commsHubDraft', 'Draft a reply.', payload, { maxTokens: 2200 });
    if (succeeds) assert.equal((await run).evidenceRepaired, true);
    else await assert.rejects(run, { code: 'reply_evidence_reference_invalid' });
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.route === 'commsHubDraft' && c.options.max_tokens === 2200));
    assert.match(calls[1].options.messages[1].content, /approved\/source/);
  }
});

test('a failed replay cannot reset attempt numbering or release the replay gate before completion', async (t) => {
  const { seed, operations, db } = fixture(t);
  await seed('failure', 'quarantined');
  const replay = await operations.beginQuarantineReplay({ id: 'q-failure', actor: 'admin' });
  await operations.upsertQuarantineItem({ id: 'q-failure', sourceType: 'delayed_action', sourceId: 'failure',
    failureClass: 'recoverable', attempts: 1, idempotencyKey: 'q-failure', createdAt: at });
  assert.equal(db.prepare("SELECT status FROM comms_hub_quarantine_items WHERE id = 'q-failure'").get().status, 'replay_pending');
  await assert.rejects(operations.beginQuarantineReplay({ id: 'q-failure', actor: 'other' }), { code: 'quarantine_not_replayable' });
  await operations.finishQuarantineReplay({ id: 'q-failure', attemptId: replay.attemptId, outcome: 'failed' });
  const next = await operations.beginQuarantineReplay({ id: 'q-failure', actor: 'admin' });
  assert.equal(next.item.attempts, 10);
});

test('replay claim rolls back when attempt history cannot be persisted', async (t) => {
  const { seed, operations, db } = fixture(t);
  await seed('rollback-replay', 'quarantined');
  db.exec("CREATE TRIGGER reject_replay BEFORE INSERT ON comms_hub_quarantine_attempts BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;");
  await assert.rejects(operations.beginQuarantineReplay({ id: 'q-rollback-replay', actor: 'admin' }));
  const item = db.prepare("SELECT status, attempts FROM comms_hub_quarantine_items WHERE id = 'q-rollback-replay'").get();
  assert.equal(item.status, 'quarantined');
  assert.equal(item.attempts, 8);
});

test('stale replay recovery releases interrupted work but preserves recent, leased and uncertain claims', async (t) => {
  const { seed, operations, db } = fixture(t);
  for (const status of ['scheduled', 'quarantined', 'complete', 'leased']) {
    await seed(`stale-${status}`, status);
    await operations.beginQuarantineReplay({ id: `q-stale-${status}`, actor: 'admin', at: '2026-11-16T06:00:00.000Z' });
  }
  await seed('uncertain-stale', 'quarantined', { uncertain: true });
  await operations.beginQuarantineReplay({ id: 'q-uncertain-stale', actor: 'admin', at: '2026-11-16T06:00:00.000Z' });
  await seed('recent-replay', 'quarantined');
  await operations.beginQuarantineReplay({ id: 'q-recent-replay', actor: 'admin', at: '2026-11-16T07:59:00.000Z' });
  assert.equal(await operations.recoverStaleQuarantineReplays({ at }), 3);
  const status = (id) => db.prepare('SELECT status FROM comms_hub_quarantine_items WHERE id = ?').get(`q-${id}`).status;
  assert.equal(status('stale-complete'), 'replayed');
  assert.equal(status('stale-scheduled'), 'quarantined');
  assert.equal(status('stale-quarantined'), 'quarantined');
  for (const id of ['stale-leased', 'uncertain-stale', 'recent-replay']) assert.equal(status(id), 'replay_pending');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comms_hub_quarantine_attempts WHERE outcome = 'blocked'").get().n, 3);
  assert.equal(await operations.recoverStaleQuarantineReplays({ at }), 0);
});
