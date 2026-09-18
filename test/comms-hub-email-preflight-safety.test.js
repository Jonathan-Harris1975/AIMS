import test from "node:test";
import assert from "node:assert/strict";
import { CommsHubEmailPollWorker } from "../services/comms-hub/workers/emailPollWorker.js";

test("first email poll performs bounded recent recovery before establishing the current UID watermark", async () => {
  const calls = { cursor: 0, fetch: [], persist: [], complete: [] };
  const context = {
    config: {
      emailPollWorkerEnabled: true,
      emailPollMs: 60_000,
      emailPollLeaseMs: 180_000,
      emailPollBatchSize: 25,
      emailHistoricalBackfillEnabled: false,
      emailStartupRecoveryUidLookback: 25,
      emailStartupRecoveryMaxAgeDays: 14,
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
      async fetchMessages({ afterUid }) {
        calls.fetch.push(afterUid);
        if (afterUid === 4296) {
          return { mailbox: "INBOX", uidValidity: 77, highestUid: 4321, messages: [{ uid: 4310, parsed: { receivedAt: "2026-09-07T09:30:00.000Z" } }] };
        }
        return { mailbox: "INBOX", uidValidity: 77, highestUid: 4321, messages: [] };
      },
    },
    emailService: { async persistFetched(value) { calls.persist.push(value); return { attachments: [], conversationId: "conv-1", messageId: "msg-1" }; } },
    quarantineService: { async quarantine() {} },
  };

  const worker = new CommsHubEmailPollWorker({ context });
  const result = await worker.runOnce({ now: new Date("2026-09-07T10:00:00.000Z") });
  assert.equal(result.processed, 1);
  assert.equal(result.startupRecovery, true);
  assert.equal(result.recoveryLookbackUids, 25);
  assert.equal(result.highestUid, 4321);
  assert.equal(calls.cursor, 1);
  assert.deepEqual(calls.fetch, [4296, 4310]);
  assert.equal(calls.persist.length, 1);
  assert.equal(calls.persist[0].uid, 4310);
  assert.equal(calls.complete.length, 1);
  assert.equal(calls.complete[0].lastUid, 4321);
  assert.equal(calls.complete[0].uidValidity, 77);
});

test("forced email poll can re-check a bounded UID window without moving the watermark backwards", async () => {
  const calls = { fetch: [], persist: [], complete: [] };
  const context = {
    config: {
      emailPollWorkerEnabled: true, emailPollMs: 60_000, emailPollLeaseMs: 180_000, emailPollBatchSize: 25,
      emailHistoricalBackfillEnabled: false, oneComEmailAccountKey: "info", oneComMailbox: "INBOX",
    },
    operationsRepository: {
      async resetEmailPollStateForReplay() {},
      async claimEmailPollState() { return { last_uid: 500, uid_validity: 77, attempts: 1 }; },
      async completeEmailPollState(value) { calls.complete.push(value); return value; },
      async failEmailPollState() { throw new Error("must not fail"); },
    },
    oneComMail: {
      async getMailboxCursor() { return { mailbox: "INBOX", uidValidity: 77, highestUid: 500 }; },
      async fetchMessages({ afterUid }) {
        calls.fetch.push(afterUid);
        if (afterUid === 400) return { uidValidity: 77, highestUid: 500, messages: [{ uid: 450, parsed: { receivedAt: "2026-09-01T10:00:00.000Z" } }] };
        return { uidValidity: 77, highestUid: 500, messages: [] };
      },
    },
    emailService: { async persistFetched(value) { calls.persist.push(value); return { duplicate: true, attachments: [] }; } },
    quarantineService: { async quarantine() {} },
  };

  const worker = new CommsHubEmailPollWorker({ context });
  const result = await worker.runOnce({ force: true, lookbackUids: 100, now: new Date("2026-09-07T10:00:00.000Z") });
  assert.equal(result.processed, 1);
  assert.equal(result.highestUid, 500);
  assert.deepEqual(calls.fetch, [400, 450]);
  assert.equal(calls.persist[0].uid, 450);
  assert.equal(calls.complete[0].lastUid, 500);
});

test("email poll start catches a rejected boot-time run instead of leaking an unhandled rejection", async () => {
  const context = {
    config: {
      emailPollWorkerEnabled: true,
      emailPollMs: 60_000,
      emailPollLeaseMs: 180_000,
      emailPollBatchSize: 25,
      emailHistoricalBackfillEnabled: false,
      oneComEmailAccountKey: "info",
      oneComEmailAddress: "info@jonathan-harris.online",
      oneComMailbox: "INBOX",
    },
  };
  const worker = new CommsHubEmailPollWorker({ context });
  worker.runOnce = async () => { throw new Error("simulated IMAP boot failure"); };
  assert.equal(worker.start(), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await worker.stop();
});

test("successful empty email poll advances state and reports zero processed", async () => {
  const calls = { complete: [] };
  const context = {
    config: {
      emailPollWorkerEnabled: true,
      emailPollMs: 60_000,
      emailPollLeaseMs: 180_000,
      emailPollBatchSize: 25,
      emailHistoricalBackfillEnabled: false,
      oneComEmailAccountKey: "info",
      oneComEmailAddress: "info@jonathan-harris.online",
      oneComMailbox: "INBOX",
    },
    operationsRepository: {
      async claimEmailPollState() { return { last_uid: 4321, uid_validity: 77, attempts: 1, lease_expires_at: "2099-01-01T00:00:00.000Z" }; },
      async completeEmailPollState(value) { calls.complete.push(value); return value; },
      async failEmailPollState() { throw new Error("must not fail"); },
    },
    oneComMail: {
      async getMailboxCursor() { return { mailbox: "INBOX", uidValidity: 77, highestUid: 4321 }; },
      async fetchMessages() { return { mailbox: "INBOX", uidValidity: 77, highestUid: 4321, messages: [] }; },
    },
    emailService: { async persistFetched() { throw new Error("nothing should be persisted"); } },
    quarantineService: { async quarantine() {} },
  };

  const worker = new CommsHubEmailPollWorker({ context });
  const result = await worker.runOnce({ now: new Date("2026-09-07T10:00:00.000Z") });
  assert.equal(result.processed, 0);
  assert.equal(result.highestUid, 4321);
  assert.equal(calls.complete.length, 1);
  assert.equal(calls.complete[0].lastUid, 4321);
});

test("automatic email polling stops at the configured business-hours boundary before touching D1 or IMAP", async () => {
  const calls = { claim: 0, cursor: 0, fetch: 0 };
  const context = {
    config: {
      emailPollWorkerEnabled: true,
      emailPollMs: 60_000,
      emailPollLeaseMs: 180_000,
      emailPollBatchSize: 25,
      emailHistoricalBackfillEnabled: false,
      oneComEmailAccountKey: "info",
      oneComEmailAddress: "info@jonathan-harris.online",
      oneComMailbox: "INBOX",
      businessTimeZone: "Europe/London",
      businessStartHour: 9,
      businessEndHour: 17,
    },
    operationsRepository: {
      async claimEmailPollState() { calls.claim += 1; throw new Error("must not claim outside business hours"); },
    },
    oneComMail: {
      async getMailboxCursor() { calls.cursor += 1; throw new Error("must not connect to IMAP outside business hours"); },
      async fetchMessages() { calls.fetch += 1; throw new Error("must not fetch outside business hours"); },
    },
  };

  const worker = new CommsHubEmailPollWorker({ context });
  const result = await worker.runOnce({ now: new Date("2026-09-06T20:00:00.000Z") });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "outside_business_hours");
  assert.equal(result.nextAttemptAt, "2026-09-07T08:00:00.000Z");
  assert.deepEqual(calls, { claim: 0, cursor: 0, fetch: 0 });
});

test("forced email replay can still be run deliberately outside business hours", async () => {
  const calls = { reset: 0, claim: 0, cursor: 0 };
  const context = {
    config: {
      emailPollWorkerEnabled: true,
      emailPollMs: 60_000,
      emailPollLeaseMs: 180_000,
      emailPollBatchSize: 25,
      emailHistoricalBackfillEnabled: false,
      oneComEmailAccountKey: "info",
      oneComEmailAddress: "info@jonathan-harris.online",
      oneComMailbox: "INBOX",
      businessTimeZone: "Europe/London",
      businessStartHour: 9,
      businessEndHour: 17,
    },
    operationsRepository: {
      async resetEmailPollStateForReplay() { calls.reset += 1; },
      async claimEmailPollState() { calls.claim += 1; return { last_uid: 5, uid_validity: 77, attempts: 1 }; },
      async completeEmailPollState(value) { return value; },
      async failEmailPollState() { throw new Error("must not fail"); },
    },
    oneComMail: {
      async getMailboxCursor() { calls.cursor += 1; return { mailbox: "INBOX", uidValidity: 77, highestUid: 5 }; },
      async fetchMessages() { return { mailbox: "INBOX", uidValidity: 77, highestUid: 5, messages: [] }; },
    },
    emailService: { async persistFetched() { throw new Error("nothing should be persisted"); } },
    quarantineService: { async quarantine() {} },
  };

  const worker = new CommsHubEmailPollWorker({ context });
  const result = await worker.runOnce({ force: true, now: new Date("2026-09-06T20:00:00.000Z") });
  assert.equal(result.processed, 0);
  assert.deepEqual(calls, { reset: 1, claim: 1, cursor: 1 });
});

