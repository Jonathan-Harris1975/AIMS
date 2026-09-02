import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  evaluateOperationWindowClaim,
  reusableOperationTaskResults,
} from "../services/ops/operationWindowState.js";

test("daily operation windows stay idempotent but recover failed runs within a bounded budget", async () => {
  const source = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  const durable = await readFile(new URL("../services/ops/operationWindowState.js", import.meta.url), "utf8");
  const stateFile = await readFile(new URL("../services/shared/utils/stateFile.js", import.meta.url), "utf8");

  assert.match(source, /const forceRerun = \[req\.query\?\.force, req\.body\?\.force, req\.get\?\.\("x-operation-force"\)\]/);
  assert.match(source, /AIMS_OPERATION_AUTO_RECOVERY_ENABLED/);
  assert.match(source, /AIMS_OPERATION_MAX_ATTEMPTS/);
  assert.match(source, /AIMS_OPERATION_RECOVERY_COOLDOWN_MS/);
  assert.match(source, /AIMS_OPERATION_STALE_AFTER_MS/);
  assert.match(source, /AIMS_OPERATION_HEARTBEAT_MS/);
  assert.match(source, /allowRecovery,/);
  assert.match(source, /resumeResults/);
  assert.match(source, /getOperationWindowReceipt\(id\)/);
  assert.match(source, /persistOperationWindow\(job\)/);
  assert.match(durable, /same-day-window-already-executed/);
  assert.match(durable, /same-day-window-already-running/);
  assert.match(durable, /same-day-window-claimed-by-another-instance/);
  assert.match(durable, /same-day-window-recovery-cooldown/);
  assert.match(durable, /same-day-window-recovery-exhausted/);
  assert.match(durable, /reusableOperationTaskResults/);
  assert.match(durable, /flushStateWrites\(\{ throwOnError: process\.env\.NODE_ENV === "production" \}\)/);
  assert.match(stateFile, /"operation-window-state\.json"/);
});

test("failed operation receipts can recover, while active and successful receipts remain protected", () => {
  const failed = {
    status: "completed-with-failures",
    attempt: 1,
    executionId: "execution-1",
    finishedAt: "2026-09-02T09:00:00.000Z",
    failures: 2,
  };
  const recovery = evaluateOperationWindowClaim(failed, {
    allowRecovery: true,
    maxAttempts: 3,
    recoveryCooldownMs: 60_000,
    nowMs: Date.parse("2026-09-02T09:02:00.000Z"),
  });
  assert.equal(recovery.claimable, true);
  assert.equal(recovery.attempt, 2);
  assert.equal(recovery.recovery, true);

  const cooldown = evaluateOperationWindowClaim(failed, {
    allowRecovery: true,
    maxAttempts: 3,
    recoveryCooldownMs: 60_000,
    nowMs: Date.parse("2026-09-02T09:00:30.000Z"),
  });
  assert.equal(cooldown.claimable, false);
  assert.equal(cooldown.reason, "same-day-window-recovery-cooldown");

  const exhausted = evaluateOperationWindowClaim({ ...failed, attempt: 3 }, {
    allowRecovery: true,
    maxAttempts: 3,
    nowMs: Date.parse("2026-09-02T10:00:00.000Z"),
  });
  assert.equal(exhausted.claimable, false);
  assert.equal(exhausted.reason, "same-day-window-recovery-exhausted");

  assert.equal(evaluateOperationWindowClaim({ status: "running" }, { allowRecovery: true }).reason, "same-day-window-already-running");
  assert.equal(evaluateOperationWindowClaim({ status: "completed", failures: 0 }, { allowRecovery: true }).reason, "same-day-window-already-executed");
});

test("stale active receipts recover without replaying successful tasks", () => {
  const stale = evaluateOperationWindowClaim({
    status: "running",
    attempt: 1,
    executionId: "interrupted-execution",
    updatedAt: "2026-09-02T08:00:00.000Z",
  }, {
    allowRecovery: true,
    staleAfterMs: 30 * 60_000,
    recoveryCooldownMs: 60_000,
    nowMs: Date.parse("2026-09-02T08:31:00.000Z"),
  });
  assert.equal(stale.claimable, true);
  assert.equal(stale.recovery, true);

  const fresh = evaluateOperationWindowClaim({
    status: "running",
    attempt: 1,
    updatedAt: "2026-09-02T08:20:00.000Z",
  }, {
    allowRecovery: true,
    staleAfterMs: 30 * 60_000,
    nowMs: Date.parse("2026-09-02T08:31:00.000Z"),
  });
  assert.equal(fresh.claimable, false);
  assert.equal(fresh.reason, "same-day-window-already-running");

  const reusable = reusableOperationTaskResults({
    resumeResults: [{ name: "rss-rewrite", ok: true, result: { ok: true } }],
    results: [
      { name: "rss-rewrite", ok: true, result: { ok: true, revision: 2 } },
      { name: "blotato-am", ok: false, result: { ok: false } },
      { name: "zernio-wednesday", ok: true, result: { ok: true } },
    ],
  });
  assert.deepEqual(reusable.map((item) => item.name), ["rss-rewrite", "zernio-wednesday"]);
  assert.equal(reusable[0].result.revision, 2);
});
