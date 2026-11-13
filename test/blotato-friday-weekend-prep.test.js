import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveBlotatoTargetDate, paidRenderGuardDate } from "../services/blotato/utils/autoPublishService.js";
import { reservePaidRender, linkPaidRenderVisual } from "../services/blotato/utils/creditGuard.js";

test("Friday alone may prepare the immediately upcoming weekend with explicit dates", () => {
  const friday = new Date("2026-11-13T10:00:00Z");
  assert.equal(resolveBlotatoTargetDate("", friday), "2026-11-13");
  assert.equal(resolveBlotatoTargetDate("2026-11-14", friday), "2026-11-14");
  assert.equal(resolveBlotatoTargetDate("2026-11-15", friday), "2026-11-15");
  assert.throws(() => resolveBlotatoTargetDate("2026-11-16", friday), /upcoming Saturday\/Sunday/);
  assert.throws(() => resolveBlotatoTargetDate("2026-11-12", friday), /upcoming Saturday\/Sunday/);
  assert.throws(() => resolveBlotatoTargetDate("2026-11-14", new Date("2026-11-12T10:00:00Z")), /Friday UK time/);
  assert.throws(() => resolveBlotatoTargetDate("garbage", friday), /YYYY-MM-DD/);
  const dstFriday = new Date("2027-03-26T10:00:00Z");
  assert.equal(resolveBlotatoTargetDate("2027-03-28", dstFriday), "2027-03-28");
});

test("six Friday pre-renders charge the Friday credit ledger, never Saturday/Sunday", async () => {
  let ledger = null, version = 0;
  const store = {
    read: async () => ({ ledger: structuredClone(ledger), exists: Boolean(ledger), eTag: String(version) }),
    write: async (_month, next, old) => {
      if (old.exists !== Boolean(ledger) || (old.exists && old.eTag !== String(version))) return false;
      ledger = structuredClone(next);
      version += 1;
      return true;
    },
  };
  const slots = [
    ["friday-am", "2026-11-13"], ["friday-pm", "2026-11-13"],
    ["saturday-am", "2026-11-14"], ["saturday-pm", "2026-11-14"],
    ["sunday-am", "2026-11-15"], ["sunday-pm", "2026-11-15"],
  ];
  for (const [slot, publicationDate] of slots) {
    const reservationId = `BLT-${slot}:attempt-1`;
    const created = await reservePaidRender({ reservationId, scheduleDate: "2026-11-13", expectedCredits: 5,
      dailyCap: 6, monthlyCap: 1250 }, store);
    await linkPaidRenderVisual({ reservationId, scheduleDate: "2026-11-13", visualId: `video-${slot}` }, store);
    assert.equal(created.dayCount, slots.indexOf(slots.find(([s]) => s === slot)) + 1);
    assert.equal(paidRenderGuardDate({ creditGuardDate: "2026-11-13", scheduleDate: publicationDate }), "2026-11-13");
  }
  assert.equal(ledger.entries.length, 6);
  assert.ok(ledger.entries.every(entry => entry.date === "2026-11-13"));
  await assert.rejects(reservePaidRender({ reservationId: "extra", scheduleDate: "2026-11-13",
    expectedCredits: 5, dailyCap: 6, monthlyCap: 1250 }, store), { code: "blotato-daily-paid-render-cap" });
  await assert.rejects(reservePaidRender({ reservationId: "another day", scheduleDate: "2026-11-16",
    expectedCredits: 6, dailyCap: 2, monthlyCap: 30 }, store), { code: "blotato-monthly-estimated-credit-cap" });
});

test("weekend videos are scheduled in advance, never published immediately", async () => {
  const routes = await readFile(new URL("../services/blotato/routes/index.js", import.meta.url), "utf8");
  const ops = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  const defaults = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(routes, /scheduleDate: requestedPublicationDate/);
  assert.match(routes, /scheduleDate: req\.body\?\.scheduleDate/);
  assert.match(ops, /upcomingFridayWeekendDate\(payload\.weekendTarget\)/);
  for (const day of ["saturday", "sunday"]) {
    for (const slot of ["am", "pm"]) {
      assert.match(ops, new RegExp(`blotato-${day}-${slot}`));
    }
  }
  assert.match(defaults, /^BLOTATO_DAILY_PAID_RENDER_CAP=2$/m);
  assert.match(defaults, /^BLOTATO_FRIDAY_PAID_RENDER_CAP=6$/m);
  assert.match(defaults, /^BLOTATO_MONTHLY_ESTIMATED_CREDIT_CAP=1250$/m);
  assert.doesNotMatch(ops, /blotato-saturday.*publish-now|blotato-sunday.*publish-now/);
});
