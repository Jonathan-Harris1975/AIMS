import test from "node:test";
import assert from "node:assert/strict";
import { operationWindowPollStatus, evaluateOperationWindowClaim, operationTaskSucceeded, reusableOperationTaskResults, sameDayBackstopAllowance,
  NEWSLETTER_RECOVERY_REVISION } from "../services/ops/operationWindowState.js";

const nowMs = Date.parse("2026-10-30T11:58:00Z");
const staleAfterMs = 30 * 60_000;
const options = { nowMs, staleAfterMs };
function interrupted() {
  return { id: "2026-10-30:friday-am", executionId: "old-process", status: "running", attempt: 3,
    updatedAt: "2026-10-30T11:00:00Z", startedAt: "2026-10-30T10:34:00Z", failures: 1,
    recoveryRevision: "newsletter-structured-recovery-2026-10-30-v1",
    results: [{ name: "blotato-am", ok: true, result: { ok: true, confirmedChannels: 4 } },
      { name: "newsletter-generate", ok: false, result: { ok: false } }] };
}

test("polling an interrupted run releases MAST's eight-hour wait without changing durable state", () => {
  const receipt = interrupted(); const before = structuredClone(receipt);
  const status = operationWindowPollStatus(receipt, options);
  assert.equal(status.status, "failed");
  assert.equal(status.terminal, true);
  assert.equal(status.retryable, true);
  assert.equal(status.interrupted, true);
  assert.equal(status.previousStatus, "running");
  assert.equal(status.updatedAt, receipt.updatedAt);
  assert.deepEqual(receipt, before);
  const claim = evaluateOperationWindowClaim(receipt, { ...options, allowRecovery: true,
    recoveryRevision: NEWSLETTER_RECOVERY_REVISION });
  assert.equal(claim.claimable, true);
  assert.equal(claim.revisionRecovery, true);
  assert.deepEqual(reusableOperationTaskResults(receipt).map(r => r.name), ["blotato-am"]);
});

test("fresh heartbeats, terminal runs and disabled timeout detection remain untouched", () => {
  for (const receipt of [
    { ...interrupted(), updatedAt: "2026-10-30T11:57:30Z" },
    { ...interrupted(), status: "completed", failures: 0 },

    { ...interrupted(), updatedAt: "invalid", startedAt: "invalid" },
  ]) assert.equal(operationWindowPollStatus(receipt, options), receipt);
  const receipt = interrupted();
  assert.equal(operationWindowPollStatus(receipt, { ...options, staleAfterMs: 0 }), receipt);
  assert.equal(operationWindowPollStatus(null, options), null);
});

test("accepted work with no heartbeat uses start time; disabled recovery is explicitly terminal", () => {
  const status = operationWindowPollStatus({ ...interrupted(), status: "accepted", updatedAt: null },
    { ...options, allowRecovery: false });
  assert.equal(status.status, "failed");
  assert.equal(status.terminal, true);
  assert.equal(status.retryable, false);
});

test("the live status route exposes interruption and leaves the receipt available for normal reclaim", async () => {
  const [{ default: express }, { default: request }, { default: router }, state] = await Promise.all([
    import("express"), import("supertest"), import("../services/ops/index.js"),
    import("../services/shared/utils/stateFile.js"),
  ]);
  const previous = await state.readJsonStateFresh("operation-window-state.json", { receipts: [] });
  const receipt = { ...interrupted(), updatedAt: new Date(Date.now() - 60 * 60_000).toISOString() };
  const app = express(); app.use("/ops", router);
  try {
    state.writeJsonState("operation-window-state.json", { receipts: [receipt] });
    await state.flushStateWrites({ throwOnError: true });
    const response = await request(app).get(`/ops/jobs/${encodeURIComponent(receipt.id)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.body.job.status, "failed");
    assert.equal(response.body.job.retryable, true);
    const saved = await state.readJsonStateFresh("operation-window-state.json", { receipts: [] });
    assert.deepEqual(saved.receipts, [receipt], "GET never claims, completes or restarts provider work");
  } finally {
    state.writeJsonState("operation-window-state.json", previous);
    await state.flushStateWrites({ throwOnError: true });
  }
});


test("a settled failure advertises a deployment recovery only when the durable claim permits it", () => {
  const receipt = { ...interrupted(), status: "completed-with-failures", terminal: true,
    finishedAt: "2026-10-30T11:00:00Z" };
  const available = operationWindowPollStatus(receipt, { ...options, recoveryRevision: NEWSLETTER_RECOVERY_REVISION });
  assert.equal(available.status, "completed-with-failures");
  assert.equal(available.recoveryAvailable, true);
  assert.equal(available.retryable, true);
  assert.equal(operationWindowPollStatus({ ...receipt, recoveryRevision: NEWSLETTER_RECOVERY_REVISION },
    { ...options, recoveryRevision: NEWSLETTER_RECOVERY_REVISION }).recoveryAvailable, undefined);
  assert.equal(operationWindowPollStatus(receipt, { ...options, allowRecovery: false,
    recoveryRevision: NEWSLETTER_RECOVERY_REVISION }).recoveryAvailable, undefined);
  assert.equal(operationWindowPollStatus({ ...receipt, finishedAt: "2026-10-30T11:57:45Z" },
    { ...options, recoveryRevision: NEWSLETTER_RECOVERY_REVISION }).recoveryAvailable, undefined);
});

test("an incomplete or ambiguous skip cannot count as finished content", () => {
  const confirmed = { name: "blog-social", ok: true,
    result: { ok: true, skipped: true, existing: { sessionId: "previous-complete" } } };
  const missingSource = { name: "blog-social", ok: true,
    result: { ok: true, skipped: true, reason: "source_not_ready" } };
  const skippedPublish = { name: "zernio-tuesday", ok: true,
    result: { ok: true, skipped: true, reason: "still_owned_by_another_job" } };
  const acceptedOnly = { name: "newsletter-send", ok: true,
    result: { ok: true, status: "accepted" } };
  const confirmedDelivery = { name: "newsletter-send", ok: true,
    result: { ok: true, skipped: true, status: "already_dispatched" } };
  const intentionalDisable = { name: "newsletter-generate", ok: true,
    skipped: true, reason: "newsletter-disabled-by-configuration" };

  assert.equal(operationTaskSucceeded(confirmed), true);
  assert.equal(operationTaskSucceeded(missingSource), false);
  assert.equal(operationTaskSucceeded(skippedPublish), false);
  assert.equal(operationTaskSucceeded(acceptedOnly), false);
  assert.equal(operationTaskSucceeded(confirmedDelivery), true);
  assert.equal(operationTaskSucceeded(intentionalDisable), true);
  assert.equal(operationTaskSucceeded({ name: "zernio-friday", ok: true,
    result: { ok: true, status: "partial", partialFailure: true } }), false);
  const prior = { results: [confirmed, missingSource, skippedPublish,
    acceptedOnly, confirmedDelivery, intentionalDisable] };
  assert.deepEqual(reusableOperationTaskResults(prior).map((entry) => entry.name),
    ["blog-social", "newsletter-send", "newsletter-generate"]);
});

test("operation orchestration fails uncertain successful HTTP skips rather than caching them", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  assert.match(source, /reason: "content-task-completion-unverified", retryable: true/);
  assert.match(source, /operationDependencyReady = \(dependency\) => operationTaskSucceeded\(dependency\)/);
  assert.match(source, /if \(taskResult\.ok && !operationTaskSucceeded\(taskResult\)\)/);
});

test("late content recovery slots each reserve exactly one bounded extra attempt", () => {
  const id = "2026-11-13:friday-am";
  const failed = { id, window: "friday-am", status: "completed-with-failures",
    attempt: 3, recoveryRevision: NEWSLETTER_RECOVERY_REVISION,
    finishedAt: "2026-11-13T10:55:00Z",
    results: [{ name: "newsletter-generate", ok: false, retryable: true }] };
  const check = (receipt, time) => evaluateOperationWindowClaim(receipt, {
    nowMs: Date.parse(`2026-11-13T${time}:00Z`),
    allowRecovery: true, maxAttempts: 3, recoveryCooldownMs: 60_000,
    recoveryRevision: NEWSLETTER_RECOVERY_REVISION,
  });

  assert.equal(sameDayBackstopAllowance(failed, Date.parse("2026-11-13T15:44:00Z")), 0);
  assert.equal(check(failed, "15:44").claimable, false);
  assert.equal(sameDayBackstopAllowance(failed, Date.parse("2026-11-13T15:45:00Z")), 1);
  assert.deepEqual({ allowed: check(failed, "15:45").claimable,
    attempt: check(failed, "15:45").attempt }, { allowed: true, attempt: 4 });
  const fourthAttempt = { ...failed, attempt: 4, finishedAt: "2026-11-13T15:55:00Z" };
  assert.equal(check(fourthAttempt, "16:30").claimable, false);
  assert.equal(sameDayBackstopAllowance(fourthAttempt, Date.parse("2026-11-13T21:20:00Z")), 2);
  assert.equal(check(fourthAttempt, "21:20").attempt, 5);
  const fifthAttempt = { ...failed, attempt: 5, finishedAt: "2026-11-13T21:30:00Z" };
  assert.equal(check(fifthAttempt, "22:00").claimable, false);
  assert.equal(sameDayBackstopAllowance(failed, Date.parse("2026-11-14T15:45:00Z")), 0);

  const podcast = { ...failed, id: "2026-11-13:friday-pm", window: "friday-pm" };
  assert.equal(sameDayBackstopAllowance(podcast, Date.parse("2026-11-13T18:29:00Z")), 0);
  assert.equal(sameDayBackstopAllowance(podcast, Date.parse("2026-11-13T18:30:00Z")), 1);
  assert.equal(sameDayBackstopAllowance(podcast, Date.parse("2026-11-13T22:10:00Z")), 2);
  assert.equal(sameDayBackstopAllowance({ ...failed, window: "unrecognised" },
    Date.parse("2026-11-13T22:00:00Z")), 0);
  assert.equal(sameDayBackstopAllowance({ ...failed, id: "2026-11-12:thursday-am" },
    Date.parse("2026-11-13T21:20:00Z")), 0);
});
