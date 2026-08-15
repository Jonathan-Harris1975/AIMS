import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../services/comms-hub/workers/emailPollWorker.js", import.meta.url), "utf8");

test("email poll worker preserves first-run no-history boundary", () => {
  assert.match(source, /emailHistoricalBackfillEnabled/);
  assert.match(source, /historical_baseline_established/);
  assert.match(source, /getMailboxCursor/);
});

test("email poll worker re-baselines on UIDVALIDITY change or mailbox reset", () => {
  assert.match(source, /uidvalidity_rebaseline/);
  assert.match(source, /mailbox_reset_rebaseline/);
  assert.match(source, /uidValidityChanged/);
});

test("email poll worker catches the boot-time run and exposes lifecycle telemetry", () => {
  assert.match(source, /commsHub\.emailPoll\.started/);
  assert.match(source, /commsHub\.emailPoll\.initialRunFailed/);
  assert.match(source, /void this\.runOnce\(\)\.catch/);
  assert.match(source, /commsHub\.emailPoll\.complete/);
  assert.match(source, /commsHub\.emailPoll\.skipped/);
});

test("email poll worker reports provider stage and D1 due-state diagnostics", () => {
  assert.match(source, /providerStage/);
  assert.match(source, /getEmailPollState/);
  assert.match(source, /nextAttemptAt/);
  assert.match(source, /leaseExpiresAt/);
});
