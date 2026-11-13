import test from "node:test";
import assert from "node:assert/strict";
import { fridayWeekendBlotatoPlan, WEEKEND_VIDEO_LANES } from "../services/blotato/utils/weekendSchedule.js";
import { getShortLaneJobTypes, listShortLaneConfigs } from "../services/blotato/utils/shortLanes.js";

test("Friday prepares four distinct provider-scheduled Saturday and Sunday shorts", () => {
  const now = new Date("2026-11-13T12:30:00Z");
  const results = [
    fridayWeekendBlotatoPlan("saturday", "am", now),
    fridayWeekendBlotatoPlan("saturday", "pm", now),
    fridayWeekendBlotatoPlan("sunday", "am", now),
    fridayWeekendBlotatoPlan("sunday", "pm", now),
  ];
  assert.deepEqual(results.map(p => [p.laneSlug, p.scheduleDate, p.scheduleSlot]), [
    ["weekend-brief", "2026-11-14", "am"],
    ["weekend-debate", "2026-11-14", "pm"],
    ["weekend-lesson", "2026-11-15", "am"],
    ["weekend-spotlight", "2026-11-15", "pm"],
  ]);
  assert.equal(new Set(results.map(p => p.laneSlug)).size, 4);
  assert.deepEqual(Object.keys(WEEKEND_VIDEO_LANES), ["saturday", "sunday"]);
  const laneSet = new Set(listShortLaneConfigs().map(p => p.slug));
  assert.ok(results.every(p => laneSet.has(p.laneSlug)));
  assert.equal(new Set(getShortLaneJobTypes()).size, 9);
  assert.deepEqual(fridayWeekendBlotatoPlan("sunday", "am", now), results[2],
    "repeated Friday triggers must target the same provider slot and durable job identity");
});

test("Friday-only preparation respects London DST and refuses wrong-day writes", () => {
  for (const [clock, expected] of [["2027-03-26T10:00:00Z", "2027-03-28"], ["2026-10-23T10:00:00Z", "2026-10-25"]]) {
    assert.equal(fridayWeekendBlotatoPlan("sunday", "pm", new Date(clock)).scheduleDate, expected);
  }
  for (const clock of ["2026-11-12T12:00:00Z", "2026-11-14T12:00:00Z"]) {
    assert.equal(fridayWeekendBlotatoPlan("saturday", "am", new Date(clock)), null);
  }
  assert.equal(fridayWeekendBlotatoPlan("monday", "am", new Date("2026-11-13T12:00:00Z")), null);
});
