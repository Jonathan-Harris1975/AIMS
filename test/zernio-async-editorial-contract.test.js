import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stableZernioAsyncPayload } from "../services/zernio/utils/asyncJobIdentity.js";
import { startAsyncServiceRouteJob } from "../services/shared/utils/asyncServiceRouteJobs.js";
import { asyncServiceJobType } from "../services/shared/utils/asyncServiceRouteJobs.js";
import { completeJob, getPublicJob, flushJobStoreWrites } from "../services/shared/utils/jobStore.js";

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
    result: { ok: true, confirmed: true, scheduled: true },
  });
  await flushJobStoreWrites({ throwOnError: true });
  let calls = 0;
  const receipt = await startAsyncServiceRouteJob({
    service: "zernio", lane, payload: { sessionId, weekday: "monday" },
    runner: async () => { calls++; return { ok: true }; },
    reuseTerminal: true,
  });
  assert.equal(receipt.sessionId, sessionId);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.result.ok, true);
  assert.equal(receipt.started, false);
  assert.equal(receipt.duplicateJob, true);
  assert.equal(calls, 0);
  assert.ok(getPublicJob(asyncServiceJobType("zernio", lane), sessionId));
});

test("failed Zernio async job stays retryable until its bounded attempt limit, then fails closed with pollable identity", async () => {
  const lane = "newsletter-promo";
  const sessionId = stableZernioAsyncPayload(lane, {},
    "test-failure-recovery-" + process.pid + "-" + Date.now()).sessionId;
  const type = asyncServiceJobType("zernio", lane);
  completeJob(type, sessionId, {
    attempt: 2, result: { ok: false, confirmed: false, error: "source not verified" },
  });
  await flushJobStoreWrites({ throwOnError: true });
  let calls = 0;
  const oneMore = await startAsyncServiceRouteJob({
    service: "zernio", lane, payload: { sessionId },
    runner: async () => { calls++; return { ok: false, error: "source still unverified" }; },
    reuseTerminal: true,
  });
  assert.equal(oneMore.started, true);
  assert.equal(oneMore.sessionId, sessionId);
  // Durable acceptance has happened; wait for the scheduled in-process worker
  // to settle, rather than issuing a second write.
  for (let i = 0; i < 40 && getPublicJob(type, sessionId)?.status !== "completed"; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(calls, 1);
  await flushJobStoreWrites({ throwOnError: true });
  const terminal = await startAsyncServiceRouteJob({
    service: "zernio", lane, payload: { sessionId },
    runner: async () => { calls++; return { ok: true }; }, reuseTerminal: true,
  });
  assert.equal(terminal.started, false);
  assert.equal(terminal.retryExhausted, true);
  assert.equal(terminal.ok, false);
  assert.equal(terminal.sessionId, sessionId);
  assert.equal(calls, 1);
});

test("daily Zernio publication no longer invokes the separately scheduled weekly mini-series or podcast promotion", () => {
  const source = readFileSync(new URL("../services/zernio/routes/social.js", import.meta.url), "utf8");
  assert.match(source, /const runDailyLane = runDailyLaneBase;/);
  const daily = source.slice(source.indexOf("const runDailyLane = runDailyLaneBase;"), source.indexOf("router.post(", source.indexOf("const runDailyLane = runDailyLaneBase;")));
  assert.doesNotMatch(daily, /buildAndScheduleWeeklyMiniSeries|buildAndSchedulePodcastThursdayPromo/);
  for (const pathname of ["/newsletter/promo", "/mini-series/weekly", "/podcast/thursday-promo"]) {
    const routeStart = source.indexOf('router.post(\n  "' + pathname + '"');
    assert.ok(routeStart >= 0, "route exists: " + pathname);
    const section = source.slice(routeStart, source.indexOf("\n);", routeStart));
    assert.match(section, /reuseTerminal: true/);
    assert.match(section, /stableZernioAsyncPayload/);
    assert.doesNotMatch(section, /requestDedupe\(/);
  }
});
