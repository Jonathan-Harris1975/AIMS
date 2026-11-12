import test from "node:test";
import assert from "node:assert/strict";
import { linkPaidRenderVisual, reservePaidRender } from "../services/blotato/utils/creditGuard.js";

function memoryLedger(initialLedger = null) {
  let ledger = structuredClone(initialLedger);
  let version = 0;
  return {
    read: async () => ({ ledger: structuredClone(ledger), exists: Boolean(ledger), eTag: String(version) }),
    write: async (_month, next, previous) => {
      if (previous.exists !== Boolean(ledger) || (previous.exists && previous.eTag !== String(version))) return false;
      ledger = structuredClone(next);
      version += 1;
      return true;
    },
    snapshot: () => structuredClone(ledger),
  };
}

test("calendar-month reservations survive beyond the job store's 24-hour lifetime", async () => {
  const store = memoryLedger();
  const base = { expectedCredits: 5, dailyCap: 1, monthlyCap: 10 };
  await reservePaidRender({ ...base, reservationId: "one", scheduleDate: "2026-09-01" }, store);
  await reservePaidRender({ ...base, reservationId: "two", scheduleDate: "2026-09-28" }, store);
  await assert.rejects(
    reservePaidRender({ ...base, reservationId: "three", scheduleDate: "2026-09-29" }, store),
    { code: "blotato-monthly-estimated-credit-cap" },
  );
  assert.equal(store.snapshot().entries.length, 2);
});

test("a reserved render counts against today's cap, including after provider uncertainty", async () => {
  const store = memoryLedger();
  const base = { scheduleDate: "2026-09-29", expectedCredits: 5, dailyCap: 1, monthlyCap: 100 };
  await reservePaidRender({ ...base, reservationId: "first" }, store);
  await assert.rejects(reservePaidRender({ ...base, reservationId: "second" }, store),
    { code: "blotato-daily-paid-render-cap" });
  await assert.rejects(reservePaidRender({ ...base, reservationId: "first" }, store),
    { code: "blotato-credit-reservation-exists" });
});

test("concurrent claims compare versions and only reserve within the cap", async () => {
  const store = memoryLedger();
  const base = { scheduleDate: "2026-09-29", expectedCredits: 5, dailyCap: 1, monthlyCap: 100 };
  const results = await Promise.allSettled([
    reservePaidRender({ ...base, reservationId: "first" }, store),
    reservePaidRender({ ...base, reservationId: "second" }, store),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "blotato-daily-paid-render-cap");
  assert.equal(store.snapshot().entries.length, 1);
});

test("an existing paid visual is included on the first ledger write", async () => {
  const store = memoryLedger();
  await assert.rejects(reservePaidRender({
    reservationId: "new", scheduleDate: "2026-09-29", expectedCredits: 5, dailyCap: 2, monthlyCap: 10,
    priorRenders: [{ visualId: "already-paid", date: "2026-09-14", expectedCredits: 7 }],
  }, store), { code: "blotato-monthly-estimated-credit-cap" });
  assert.deepEqual(store.snapshot().entries.map((entry) => entry.credits), [7]);
});

test("an unreadable ledger prevents a paid render", async () => {
  await assert.rejects(reservePaidRender({
    reservationId: "new", scheduleDate: "2026-09-29", expectedCredits: 5, dailyCap: 1, monthlyCap: 100,
  }, { read: async () => { throw new Error("R2 unavailable"); } }), /R2 unavailable/);
});

test("an existing reserved render and its historical legacy record count only once", async () => {
  const day = "2026-11-12";
  const sessionId = "BLT-reality-check-2026-11-12-am";
  const store = memoryLedger({ version: 1, month: "2026-11", entries: [
    { id: `${sessionId}:attempt-1`, date: day, credits: 5 },
    { id: "legacy:visual-am", date: day, credits: 5 },
  ] });
  await reservePaidRender({
    reservationId: "BLT-reality-check-2026-11-12-pm:attempt-1",
    scheduleDate: day, expectedCredits: 5, dailyCap: 2, monthlyCap: 1250,
    priorRenders: [{ sessionId, visualId: "visual-am", date: day, expectedCredits: 5 }],
  }, store);
  assert.deepEqual(store.snapshot().entries.map((entry) => entry.id), [
    `${sessionId}:attempt-1`, "BLT-reality-check-2026-11-12-pm:attempt-1",
  ]);
});

test("the first legacy import is suppressed when the job lost its reservation metadata", async () => {
  const store = memoryLedger();
  const day = "2026-11-12";
  await reservePaidRender({
    reservationId: "BLT-reality-check-2026-11-12-am:attempt-1",
    scheduleDate: day, expectedCredits: 5, dailyCap: 2, monthlyCap: 1250,
  }, store);
  await reservePaidRender({
    reservationId: "BLT-reality-check-2026-11-12-pm:attempt-1",
    scheduleDate: day, expectedCredits: 5, dailyCap: 2, monthlyCap: 1250,
    priorRenders: [{ sessionId: "BLT-reality-check-2026-11-12-am",
      visualId: "visual-am", date: day, expectedCredits: 5 }],
  }, store);
  assert.equal(store.snapshot().entries.length, 2);
});

test("paid renders bind their provider IDs durably without an additional charge", async () => {
  const store = memoryLedger();
  await reservePaidRender({ reservationId: "first", scheduleDate: "2026-11-12",
    expectedCredits: 5, dailyCap: 2, monthlyCap: 1250 }, store);
  await linkPaidRenderVisual({ reservationId: "first", scheduleDate: "2026-11-12", visualId: "visual-1" }, store);
  await linkPaidRenderVisual({ reservationId: "first", scheduleDate: "2026-11-12", visualId: "visual-1" }, store);
  assert.deepEqual(store.snapshot().entries, [
    { id: "first", date: "2026-11-12", credits: 5, visualId: "visual-1" },
  ]);
  await assert.rejects(linkPaidRenderVisual({ reservationId: "first", scheduleDate: "2026-11-12",
    visualId: "different-provider-visual" }, store), /another visual/);
});

test("an unmatched legacy render still consumes the daily paid-render cap", async () => {
  const store = memoryLedger();
  await reservePaidRender({
    reservationId: "am", scheduleDate: "2026-11-12", expectedCredits: 5,
    dailyCap: 2, monthlyCap: 1250,
  }, store);
  await assert.rejects(reservePaidRender({
    reservationId: "pm", scheduleDate: "2026-11-12", expectedCredits: 5,
    dailyCap: 2, monthlyCap: 1250,
    priorRenders: [{ sessionId: "unrelated-session", visualId: "unknown-paid", date: "2026-11-12", expectedCredits: 5 }],
  }, store), { code: "blotato-daily-paid-render-cap" });
  assert.equal(store.snapshot().entries.length, 2);
});
