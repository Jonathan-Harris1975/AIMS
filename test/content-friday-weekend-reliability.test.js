import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fridayWeekendBlotatoPlan } from "../services/blotato/utils/weekendSchedule.js";
import { sourcePayload } from "../services/newsletter/engine/editorialCouncil.js";
import { enrichArticleEvidence } from "../services/newsletter/engine/articleEvidence.js";

test("Friday schedules exactly two videos per weekend publication day", () => {
  const friday = new Date("2026-11-13T10:00:00Z");
  assert.deepEqual(fridayWeekendBlotatoPlan("saturday", "am", friday), {
    laneSlug: "news-insight", scheduleSlot: "am", scheduleDate: "2026-11-14", publishMode: "autoshorts-scheduled",
  });
  assert.deepEqual(fridayWeekendBlotatoPlan("saturday", "pm", friday), {
    laneSlug: "model-verdict", scheduleSlot: "pm", scheduleDate: "2026-11-14", publishMode: "evening-scheduled",
  });
  assert.equal(fridayWeekendBlotatoPlan("sunday", "am", friday).scheduleDate, "2026-11-15");
  assert.equal(fridayWeekendBlotatoPlan("sunday", "pm", friday).laneSlug, "reality-check");
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
  assert.match(service, /options\.scheduleDate \|\| londonDateString\(new Date\(\)\)/);
  assert.match(service, /reservePaidRender\(\{[\s\S]*?scheduleDate: activeScheduleDate/);
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
