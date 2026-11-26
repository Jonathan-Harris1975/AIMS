import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { GuestArticleRunRepository } from "../services/outreach/services/guestArticleRunRepository.js";
import { runNextBatch } from "../services/outreach/services/batchService.js";
import { isAuthorisedOutreachSession, londonParts } from "../services/outreach/utils/schedule.js";

function d1Fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../services/comms-hub/migrations/0029_guest_article_run_ledger.sql", import.meta.url), "utf8"));
  const query = async (sql, params = []) => {
    const statement = db.prepare(sql);
    if (/^\s*SELECT/i.test(sql)) return { results: statement.all(...params), meta: { changes: 0 } };
    const response = statement.run(...params);
    return { results: [], meta: { changes: response.changes } };
  };
  const batch = async (statements) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await query(statement.sql, statement.params));
      db.exec("COMMIT");
      return results;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  return { db, d1: { query, batch } };
}

test("Guest Article logical runs are restricted to the authorised London weekday window across GMT and BST", () => {
  for (const day of ["2026-11-30", "2026-12-02", "2026-12-04"]) {
    assert.equal(isAuthorisedOutreachSession(new Date(`${day}T09:30:00Z`)), true);
  }
  for (const day of ["2026-12-01", "2026-12-03", "2026-12-05", "2026-12-06"]) {
    assert.equal(isAuthorisedOutreachSession(new Date(`${day}T09:30:00Z`)), false);
  }
  assert.equal(isAuthorisedOutreachSession(new Date("2026-11-30T11:00:00Z")), false);
  assert.equal(londonParts(new Date("2026-12-02T09:00:00Z")).date, "2026-12-02");
  assert.equal(londonParts(new Date("2026-07-01T08:00:00Z")).date, "2026-07-01");
  assert.equal(isAuthorisedOutreachSession(new Date("2026-07-01T08:30:00Z")), true);
});

test("one durable run lease prevents overlapping triggers for the same local date", async (t) => {
  const { db, d1 } = d1Fixture(); t.after(() => db.close());
  const now = () => new Date("2026-11-30T09:00:00.000Z");
  const first = new GuestArticleRunRepository(d1, { now, leaseId: () => "owner-a" });
  const second = new GuestArticleRunRepository(d1, { now, leaseId: () => "owner-b" });
  const claim = await first.claim("2026-11-30", "mast-trigger-1");
  assert.equal(claim.acquired, true);
  assert.equal(claim.occurrenceId, "guest-article:2026-11-30");
  assert.equal(claim.attempt, 1);
  assert.deepEqual(await second.claim("2026-11-30", "mast-trigger-duplicate"), {
    acquired: false, occurrenceId: claim.occurrenceId, status: "leased", completed: false, attempts: 1, result: null,
  });
  assert.equal(db.prepare("SELECT trigger_run_key FROM comms_hub_guest_article_runs").get().trigger_run_key, "mast-trigger-1");
});

test("expired run leases recover with a bounded attempt count and fence stale owners", async (t) => {
  const { db, d1 } = d1Fixture(); t.after(() => db.close());
  let current = new Date("2026-11-30T09:00:00.000Z");
  let id = 0;
  const repository = new GuestArticleRunRepository(d1, { now: () => current, leaseId: () => `owner-${++id}`, leaseMs: 60_000 });
  const first = await repository.claim("2026-11-30");
  current = new Date("2026-11-30T09:01:00.000Z");
  const second = await repository.claim("2026-11-30", "recovery-1");
  assert.equal(second.acquired, true);
  assert.equal(second.attempt, 2);
  await assert.rejects(repository.finish(first, "completed"), /lease expired or was taken/);
  current = new Date("2026-11-30T09:02:00.000Z");
  const third = await repository.claim("2026-11-30", "recovery-2");
  assert.equal(third.attempt, 3);
  await repository.finish(third, "completed_zero", { result: { processed: 1, sent: 0 } });
  assert.equal((await repository.claim("2026-11-30")).status, "completed_zero");
  assert.equal(db.prepare("SELECT attempts FROM comms_hub_guest_article_runs").get().attempts, 3);
});

test("renewed run leases prevent stale recovery until the active owner expires", async (t) => {
  const { db, d1 } = d1Fixture(); t.after(() => db.close());
  let current = new Date("2026-11-30T09:00:00.000Z");
  const repository = new GuestArticleRunRepository(d1, { now: () => current, leaseId: (() => { let n = 0; return () => `renew-${++n}`; })() });
  const first = await repository.claim("2026-11-30");
  current = new Date("2026-11-30T09:10:00.000Z");
  assert.equal(await repository.renew(first), true);
  current = new Date("2026-11-30T09:20:00.000Z");
  assert.equal((await repository.claim("2026-11-30")).acquired, false);
  current = new Date("2026-11-30T09:26:00.000Z");
  const recovered = await repository.claim("2026-11-30");
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.attempt, 2);
  assert.equal(await repository.renew(first), false);
  await assert.rejects(repository.finish(first, "completed_zero"), /taken by another worker/);
});

test("failed runs preserve a durable result and only allow bounded recovery", async (t) => {
  const { db, d1 } = d1Fixture(); t.after(() => db.close());
  let current = new Date("2026-11-30T09:00:00.000Z");
  let id = 0;
  const repository = new GuestArticleRunRepository(d1, { now: () => current, leaseId: () => `lease-${++id}`, leaseMs: 60_000 });
  const first = await repository.claim("2026-11-30");
  await repository.finish(first, "failed", { errorCode: "provider_timeout" });
  current = new Date("2026-11-30T09:01:00.000Z");
  const retry = await repository.claim("2026-11-30");
  assert.equal(retry.attempt, 2);
  const saved = await repository.finish(retry, "completed", { result: { processed: 3, sent: 1 } });
  assert.deepEqual(JSON.parse(saved.result_json), { processed: 3, sent: 1 });
  assert.equal(saved.error_code, null);
});

test("scheduled Guest Article runs use the D1 occurrence ledger and cannot replay completed work", async (t) => {
  const { db, d1 } = d1Fixture(); t.after(() => db.close());
  const previous = process.env.AIMS_OPERATION_OUTREACH_ENABLED;
  process.env.AIMS_OPERATION_OUTREACH_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.AIMS_OPERATION_OUTREACH_ENABLED;
    else process.env.AIMS_OPERATION_OUTREACH_ENABLED = previous;
  });
  const now = () => new Date("2026-11-30T09:00:00.000Z");
  let executions = 0;
  let leaseAssertions = 0;
  const options = { now, getContext: async () => ({ d1 }), execute: async ({ assertLease }) => {
    await assertLease();
    leaseAssertions += 1;
    executions += 1;
    return { processed: 1, automation: { sent: 0, queued: 0, skipped: 2, failed: 0 },
      results: [{ keyword: "AI governance", savedLeads: 2, automation: { sent: 0, results: [{ email: "editor@example.com" }] } }] };
  } };
  const first = await runNextBatch({ ...options, triggerRunKey: "mast-1" });
  assert.equal(first.status, "completed_zero");
  assert.equal(first.occurrenceId, "guest-article:2026-11-30");
  const replay = await runNextBatch({ ...options, triggerRunKey: "mast-replay" });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.status, "completed_zero");
  assert.equal(executions, 1);
  assert.equal(leaseAssertions, 1);
  const stored = db.prepare("SELECT result_json FROM comms_hub_guest_article_runs").get().result_json;
  assert.doesNotMatch(stored, /editor@example\.com/);
  assert.match(stored, /AI governance/);
});

test("durable result sanitisation accepts null per-keyword automation counts", async (t) => {
  const { db, d1 } = d1Fixture(); t.after(() => db.close());
  const previous = process.env.AIMS_OPERATION_OUTREACH_ENABLED;
  process.env.AIMS_OPERATION_OUTREACH_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.AIMS_OPERATION_OUTREACH_ENABLED;
    else process.env.AIMS_OPERATION_OUTREACH_ENABLED = previous;
  });
  const result = await runNextBatch({ now: () => new Date("2026-11-30T09:00:00.000Z"),
    getContext: async () => ({ d1 }), execute: async () => ({ processed: 1, automation: null,
      results: [{ keyword: "AI governance", savedLeads: 0, automation: null }] }) });
  assert.equal(result.status, "completed_zero");
  const stored = JSON.parse(db.prepare("SELECT result_json FROM comms_hub_guest_article_runs").get().result_json);
  assert.deepEqual(stored.results[0].automation, { sent: 0, queued: 0, skipped: 0, failed: 0 });
});

test("scheduled Guest Article recovery retries a failed run under a new fenced lease", async (t) => {
  const { db, d1 } = d1Fixture(); t.after(() => db.close());
  const previous = process.env.AIMS_OPERATION_OUTREACH_ENABLED;
  process.env.AIMS_OPERATION_OUTREACH_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.AIMS_OPERATION_OUTREACH_ENABLED;
    else process.env.AIMS_OPERATION_OUTREACH_ENABLED = previous;
  });
  let executions = 0;
  const options = { now: () => new Date("2026-11-30T09:00:00.000Z"), getContext: async () => ({ d1 }),
    execute: async ({ recovering }) => {
      executions += 1;
      if (!recovering) throw Object.assign(new Error("simulated worker fault"), { code: "test_fault" });
      return { processed: 1, automation: { sent: 0 }, results: [] };
    } };
  await assert.rejects(runNextBatch({ ...options, triggerRunKey: "mast-failed" }), /simulated worker fault/);
  const recovered = await runNextBatch({ ...options, triggerRunKey: "mast-recovery" });
  assert.equal(recovered.status, "completed_zero");
  assert.equal(recovered.attempt, 2);
  assert.equal(executions, 2);
});

test("Guest Article worker refuses off-window or disabled requests before loading runtime state", async () => {
  const previous = process.env.AIMS_OPERATION_OUTREACH_ENABLED;
  let contextLoads = 0;
  try {
    process.env.AIMS_OPERATION_OUTREACH_ENABLED = "true";
    const outside = await runNextBatch({ now: () => new Date("2026-11-30T11:00:00.000Z"),
      getContext: async () => { contextLoads += 1; return {}; } });
    assert.equal(outside.reason, "OUTSIDE_AUTHORISED_GUEST_ARTICLE_SESSION");
    process.env.AIMS_OPERATION_OUTREACH_ENABLED = "false";
    const disabled = await runNextBatch({ now: () => new Date("2026-11-30T09:00:00.000Z"),
      getContext: async () => { contextLoads += 1; return {}; } });
    assert.equal(disabled.reason, "GUEST_ARTICLE_OPERATION_DISABLED");
    assert.equal(contextLoads, 0);
  } finally {
    if (previous === undefined) delete process.env.AIMS_OPERATION_OUTREACH_ENABLED;
    else process.env.AIMS_OPERATION_OUTREACH_ENABLED = previous;
  }
});
