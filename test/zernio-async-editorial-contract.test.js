import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stableZernioAsyncPayload } from "../services/zernio/utils/asyncJobIdentity.js";
import { startAsyncServiceRouteJob } from "../services/shared/utils/asyncServiceRouteJobs.js";
import { asyncServiceJobType } from "../services/shared/utils/asyncServiceRouteJobs.js";
import { completeJob, getPublicJob } from "../services/shared/utils/jobStore.js";

test("MAST retries use an opaque, stable, route-scoped Zernio session identity", () => {
  const trigger = "zernio-newsletter-promo-monday:Europe/London:2026-11-16:11:15";
  const a = stableZernioAsyncPayload("newsletter-promo", { weekday: "monday" }, trigger);
  const b = stableZernioAsyncPayload("newsletter-promo", { weekday: "monday" }, trigger);
  assert.deepEqual(a, b);
  assert.match(a.sessionId, /^zernio-newsletter-promo-[a-f0-9]{32}$/);
  assert.ok(!a.sessionId.includes("2026-11-16"), "do not expose raw schedule keys");
  assert.notEqual(a.sessionId, stableZernioAsyncPayload("weekly-mini-series", {}, trigger).sessionId);
  assert.notEqual(a.sessionId, stableZernioAsyncPayload("newsletter-promo", {}, trigger + "retry").sessionId);
  assert.equal(stableZernioAsyncPayload("newsletter-promo", { weekday: "monday" }).sessionId, undefined);
});

test("terminal Zernio async replay returns the existing pollable job rather than triggering another paid operation", async () => {
  const lane = "newsletter-promo";
  const requestKey = "test-promo-" + process.pid + "-" + Date.now();
  const sessionId = stableZernioAsyncPayload(lane, {}, requestKey).sessionId;
  completeJob(asyncServiceJobType("zernio", lane), sessionId, {
    result: { ok: false, error: "source delivery not confirmed" },
  });
  let calls = 0;
  const receipt = await startAsyncServiceRouteJob({
    service: "zernio", lane, payload: { sessionId, weekday: "monday" },
    runner: async () => { calls++; return { ok: true }; },
    reuseTerminal: true,
  });
  assert.equal(receipt.sessionId, sessionId);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.result.ok, false);
  assert.equal(receipt.started, false);
  assert.equal(receipt.duplicateJob, true);
  assert.equal(calls, 0);
  assert.ok(getPublicJob(asyncServiceJobType("zernio", lane), sessionId));
});

test("daily Zernio publication no longer invokes the separately scheduled weekly mini-series or podcast promotion", () => {
  const source = readFileSync(new URL("../services/zernio/routes/social.js", import.meta.url), "utf8");
  assert.match(source, /const runDailyLane = runDailyLaneBase;/);
  const daily = source.slice(source.indexOf("const runDailyLane = runDailyLaneBase;"), source.indexOf("router.post(", source.indexOf("const runDailyLane = runDailyLaneBase;")));
  assert.doesNotMatch(daily, /buildAndScheduleWeeklyMiniSeries|buildAndSchedulePodcastThursdayPromo/);
  for (const pathname of ["/newsletter/promo", "/mini-series/weekly", "/podcast/thursday-promo"]) {
    const section = source.slice(source.indexOf('"' + pathname + '"'), source.indexOf("\n);", source.indexOf('"' + pathname + '"')));
    assert.match(section, /reuseTerminal: true/);
    assert.match(section, /stableZernioAsyncPayload/);
    assert.doesNotMatch(section, /requestDedupe\(/);
  }
});
