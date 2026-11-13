import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { weekendVideoPreparation, WEEKEND_VIDEO_LANES } from "../services/blotato/utils/weekendSchedule.js";
import { getShortLaneJobTypes, listShortLaneConfigs } from "../services/blotato/utils/shortLanes.js";

test("Friday prepares four distinct provider-scheduled Saturday and Sunday shorts", () => {
  const now = new Date("2026-11-13T12:30:00Z");
  const results = [
    weekendVideoPreparation({ day: "saturday", slot: "am", now }),
    weekendVideoPreparation({ day: "saturday", slot: "pm", now }),
    weekendVideoPreparation({ day: "sunday", slot: "am", now }),
    weekendVideoPreparation({ day: "sunday", slot: "pm", now }),
  ];
  assert.deepEqual(results.map(p => [p.lane, p.publishDate, p.slot]), [
    ["weekend-brief", "2026-11-14", "am"],
    ["weekend-debate", "2026-11-14", "pm"],
    ["weekend-lesson", "2026-11-15", "am"],
    ["weekend-spotlight", "2026-11-15", "pm"],
  ]);
  assert.equal(new Set(results.map(p => p.lane)).size, 4);
  assert.ok(results.every(p => p.preparedOn === "2026-11-13"));
  assert.deepEqual(Object.keys(WEEKEND_VIDEO_LANES), ["saturday", "sunday"]);
  const laneSet = new Set(listShortLaneConfigs().map(p => p.slug));
  assert.ok(results.every(p => laneSet.has(p.lane)));
  assert.equal(new Set(getShortLaneJobTypes()).size, 9);
  assert.deepEqual(weekendVideoPreparation({ day: "sunday", slot: "am", now }), results[2],
    "repeated Friday triggers must target the same provider slot and durable job identity");
});

test("Friday-only preparation respects London DST and refuses late or wrong-day writes", () => {
  const beforeSpring = new Date("2027-03-26T10:00:00Z");
  assert.equal(weekendVideoPreparation({ day: "sunday", slot: "pm", now: beforeSpring }).publishDate, "2027-03-28");
  const autumn = new Date("2026-10-23T10:00:00Z");
  assert.equal(weekendVideoPreparation({ day: "sunday", slot: "pm", now: autumn }).publishDate, "2026-10-25");
  for (const at of ["2026-11-12T12:00:00Z", "2026-11-14T12:00:00Z"]) {
    assert.throws(() => weekendVideoPreparation({ day: "saturday", slot: "am", now: new Date(at) }),
      { code: "blotato-weekend-preparation-day", statusCode: 409 });
  }
  assert.throws(() => weekendVideoPreparation({ day: "monday", slot: "am", now: beforeSpring }),
    { code: "blotato-weekend-slot-invalid" });
  assert.throws(() => weekendVideoPreparation({ day: "saturday", slot: "noon", now: beforeSpring }),
    { code: "blotato-weekend-slot-invalid" });
});

test("future publication day is separate from the actual paid render charge day", async () => {
  const src = await readFile(new URL("../services/blotato/utils/autoPublishService.js", import.meta.url), "utf8");
  const routes = await readFile(new URL("../services/blotato/routes/index.js", import.meta.url), "utf8");
  const ops = await readFile(new URL("../services/ops/index.js", import.meta.url), "utf8");
  const env = await readFile(new URL("../config/production.defaults.env", import.meta.url), "utf8");
  assert.match(src, /options\.scheduleDate \|\| londonDateString\(new Date\(\)\)/);
  assert.match(src, /const renderChargeDate = pendingRenderRecovery\?\.creditChargeDate \|\| londonDateString\(new Date\(\)\)/);
  assert.match(src, /reservationId, scheduleDate: renderChargeDate/);
  assert.match(src, /date: trim\(job\.creditChargeDate\) \|\| scheduleDateFromJob\(job\)/);
  assert.match(src, /scheduleDate: pendingRenderRecovery\.creditChargeDate \|\| renderChargeDate/);
  assert.match(src, /BLOTATO_FRIDAY_PREBUILD_PAID_RENDER_CAP", 6, 6/);
  assert.match(routes, /requestDedupe\("blotato:weekend:prepare"\)/);
  assert.match(routes, /scheduleDate: plan\.publishDate/);
  for (const day of ["saturday", "sunday"]) {
    for (const slot of ["am", "pm"]) {
      assert.match(ops, new RegExp(`"/blotato/weekend/${day}/${slot}/prepare"`));
      assert.match(env, new RegExp(`BLOTATO_SCHEDULE_${day.toUpperCase()}_${slot.toUpperCase()}=\\d{2}:\\d{2}`));
    }
  }
  assert.match(env, /BLOTATO_DAILY_PAID_RENDER_CAP=2/);
  assert.match(env, /BLOTATO_FRIDAY_PREBUILD_PAID_RENDER_CAP=6/);
});
