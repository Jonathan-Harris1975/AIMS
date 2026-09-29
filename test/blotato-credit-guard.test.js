import test from "node:test";
import assert from "node:assert/strict";
import { reservePaidRender } from "../services/blotato/utils/creditGuard.js";

function memoryLedger() {
  let ledger = null;
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
