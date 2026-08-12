import test from "node:test";
import assert from "node:assert/strict";
import { CommsHubEmailPollWorker } from "../services/comms-hub/workers/emailPollWorker.js";

test("first email poll establishes a UID watermark without fetching historical message bodies", async () => {
  const calls = { cursor: 0, fetch: 0, complete: [] };
  const context = {
    config: {
      emailPollWorkerEnabled: true,
      emailPollMs: 60_000,
      emailPollLeaseMs: 180_000,
      emailPollBatchSize: 25,
      emailHistoricalBackfillEnabled: false,
      oneComEmailAccountKey: "primary",
      oneComMailbox: "INBOX",
    },
    operationsRepository: {
      async claimEmailPollState() { return { last_uid: 0, attempts: 1 }; },
      async completeEmailPollState(value) { calls.complete.push(value); return value; },
      async failEmailPollState() { throw new Error("must not fail"); },
    },
    oneComMail: {
      async getMailboxCursor() { calls.cursor += 1; return { mailbox: "INBOX", uidValidity: 77, highestUid: 4321 }; },
      async fetchMessages() { calls.fetch += 1; throw new Error("historical bodies must not be fetched"); },
    },
    emailService: { async persistFetched() { throw new Error("historical mail must not be persisted"); } },
    quarantineService: { async quarantine() {} },
  };

  const worker = new CommsHubEmailPollWorker({ context });
  const result = await worker.runOnce();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "historical_baseline_established");
  assert.equal(result.highestUid, 4321);
  assert.equal(calls.cursor, 1);
  assert.equal(calls.fetch, 0);
  assert.equal(calls.complete.length, 1);
  assert.equal(calls.complete[0].lastUid, 4321);
  assert.equal(calls.complete[0].uidValidity, 77);
});
