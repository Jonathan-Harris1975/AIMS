import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fridayWeekendBlotatoPlan } from "../services/blotato/utils/weekendSchedule.js";
import { sourcePayload } from "../services/newsletter/engine/editorialCouncil.js";
import { enrichArticleEvidence } from "../services/newsletter/engine/articleEvidence.js";
import { paidRenderDailyCap, paidRenderGuardDate, resolveBlotatoTargetDate } from "../services/blotato/utils/autoPublishService.js";
import { reservePaidRender, linkPaidRenderVisual } from "../services/blotato/utils/creditGuard.js";

test("Friday schedules exactly two videos per weekend publication day", () => {
  const friday = new Date("2026-11-13T10:00:00Z");
  assert.deepEqual(fridayWeekendBlotatoPlan("saturday", "am", friday), {
    laneSlug: "weekend-brief", scheduleSlot: "am", scheduleDate: "2026-11-14", publishMode: "autoshorts-scheduled",
  });
  assert.deepEqual(fridayWeekendBlotatoPlan("saturday", "pm", friday), {
    laneSlug: "weekend-debate", scheduleSlot: "pm", scheduleDate: "2026-11-14", publishMode: "evening-scheduled",
  });
  assert.equal(fridayWeekendBlotatoPlan("sunday", "am", friday).scheduleDate, "2026-11-15");
  assert.equal(fridayWeekendBlotatoPlan("sunday", "pm", friday).laneSlug, "weekend-spotlight");
  assert.equal(fridayWeekendBlotatoPlan("saturday", "am", new Date("2026-11-14T10:00:00Z")), null);
  assert.equal(fridayWeekendBlotatoPlan("monday", "am", friday), null);
  assert.equal(fridayWeekendBlotatoPlan("saturday", "afternoon", friday), null);
  assert.equal(fridayWeekendBlotatoPlan("sunday", "am", new Date("2027-03-26T12:00:00Z")).scheduleDate, "2027-03-28");
});

test("weekend video routes use target-day identities, not an extra Friday paid-render reservation", async () => {
  const route = await readFile(new URL("../services/blotato/routes/index.js", import.meta.url), "utf8");
  const service = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  const ops = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  const defaults = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(route, /fridayWeekendBlotatoPlan\(req\.params\.day, req\.params\.slot\)/);
  assert.match(route, /scheduleDate: plan\.scheduleDate/);
  assert.match(service, /resolveBlotatoTargetDate\(options\.scheduleDate/);
  assert.match(service, /reservePaidRender\(\{[\s\S]*?scheduleDate: paidRenderDate/);
  for (const day of ["saturday", "sunday"]) for (const slot of ["am", "pm"]) {
    assert.ok(ops.includes(`"/blotato/weekend/${day}/${slot}/schedule"`));
    assert.match(defaults, new RegExp(`^BLOTATO_SCHEDULE_${day.toUpperCase()}_${slot.toUpperCase()}=\\d{2}:\\d{2}$`, "m"));
  }
  assert.match(defaults, /^BLOTATO_DAILY_PAID_RENDER_CAP=2$/m);
  assert.match(defaults, /^BLOTATO_MONTHLY_ESTIMATED_CREDIT_CAP=1250$/m);
});

test("factual reviewers see source-owned article text and never unverified claims as evidence", async () => {
  const source = { title: "A story", summary: "Short RSS excerpt", link: "https://example.org/news",
    publishedAt: "2026-11-13T10:00:00Z", evidenceVerified: true,
    evidence: "A".repeat(400) };
  const unverified = { title: "Unverified", summary: "RSS excerpt", link: "https://example.org/short",
    evidenceVerified: false, evidence: "Must not be shown as original article evidence" };
  const council = sourcePayload(source, [unverified]);
  assert.equal(council[0].originalArticleEvidence.length, 400);
  assert.equal(council[0].evidenceVerified, true);
  assert.equal(council[1].evidenceVerified, false);
  assert.equal("originalArticleEvidence" in council[1], false);
  let fetches = 0;
  const records = await enrichArticleEvidence([source, unverified], { fetchOne: async item => {
    fetches += 1; return { ...item, evidenceVerified: true, evidence: "verified from source" };
  } });
  assert.equal(fetches, 1, "already verified weekly sources must not be re-fetched");
  assert.equal(records[0].evidence, source.evidence);
});

test("Blotato charges the physical Friday render date and enforces six paid reservations", async () => {
  const friday = new Date("2026-11-13T10:00:00Z");
  assert.equal(resolveBlotatoTargetDate("2026-11-14", friday), "2026-11-14");
  assert.equal(resolveBlotatoTargetDate("2026-11-15", friday), "2026-11-15");
  assert.throws(() => resolveBlotatoTargetDate("2026-11-16", friday), /next Saturday/);
  assert.throws(() => resolveBlotatoTargetDate("2026-11-15", new Date("2026-11-14T10:00:00Z")), /Friday UK time/);
  const initialFriday = process.env.BLOTATO_FRIDAY_PAID_RENDER_CAP;
  const initialDaily = process.env.BLOTATO_DAILY_PAID_RENDER_CAP;
  process.env.BLOTATO_FRIDAY_PAID_RENDER_CAP = "6";
  process.env.BLOTATO_DAILY_PAID_RENDER_CAP = "2";
  let ledger = null, version = 0;
  const store = {
    read: async () => ({ ledger: structuredClone(ledger), exists: Boolean(ledger), eTag: String(version) }),
    write: async (_month, value, old) => {
      if (old.exists !== Boolean(ledger) || (old.exists && old.eTag !== String(version))) return false;
      ledger = structuredClone(value); version += 1; return true;
    },
  };
  try {
    assert.equal(paidRenderDailyCap("2026-11-13"), 6);
    assert.equal(paidRenderDailyCap("2026-11-14"), 2);
    for (const slot of ["fri-am", "fri-pm", "sat-am", "sat-pm", "sun-am", "sun-pm"]) {
      const reservationId = "BLT-" + slot + ":attempt-1";
      await reservePaidRender({ reservationId, scheduleDate: "2026-11-13",
        expectedCredits: 5, dailyCap: paidRenderDailyCap("2026-11-13"), monthlyCap: 1250 }, store);
      await linkPaidRenderVisual({ reservationId, scheduleDate: "2026-11-13", visualId: "video-" + slot }, store);
    }
    assert.equal(ledger.entries.length, 6);
    assert.ok(ledger.entries.every(entry => entry.date === "2026-11-13"));
    assert.equal(paidRenderGuardDate({ creditGuardDate: "2026-11-13", scheduleDate: "2026-11-15" }), "2026-11-13");
    await assert.rejects(reservePaidRender({ reservationId: "extra", scheduleDate: "2026-11-13",
      expectedCredits: 5, dailyCap: 6, monthlyCap: 1250 }, store), { code: "blotato-daily-paid-render-cap" });
  } finally {
    if (initialFriday === undefined) delete process.env.BLOTATO_FRIDAY_PAID_RENDER_CAP;
    else process.env.BLOTATO_FRIDAY_PAID_RENDER_CAP = initialFriday;
    if (initialDaily === undefined) delete process.env.BLOTATO_DAILY_PAID_RENDER_CAP;
    else process.env.BLOTATO_DAILY_PAID_RENDER_CAP = initialDaily;
  }
});
