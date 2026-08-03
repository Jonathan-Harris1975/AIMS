import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const opsSource = fs.readFileSync(new URL("../services/ops/index.js", import.meta.url), "utf8");
const zernioSocialSource = fs.readFileSync(new URL("../services/zernio/routes/social.js", import.meta.url), "utf8");

test("weekday AM windows contain blog-social handoff and both Blotato schedule slots", () => {
  const eveningPaths = {
    monday: "/blotato/shorts/news-insight/schedule",
    tuesday: "/blotato/shorts/model-verdict/schedule",
    wednesday: "/blotato/shorts/ai-at-work/schedule",
    thursday: "/blotato/shorts/reality-check/schedule",
    friday: "/blotato/shorts/ai-playbook/schedule",
  };
  for (const day of Object.keys(eveningPaths)) {
    const start = opsSource.indexOf(`"${day}-am": [`);
    const next = day === "friday" ? opsSource.indexOf('"friday-pm": [', start) : opsSource.indexOf(`"${({monday:"tuesday",tuesday:"wednesday",wednesday:"thursday",thursday:"friday"})[day]}-am": [`, start);
    const block = opsSource.slice(start, next);
    assert.ok(block.includes('/blog/social/daily/build'));
    assert.ok(block.includes('/zernio/blog-rss/daily'));
    assert.ok(block.includes('"blog-social"'));
    assert.ok(block.includes('/blotato/autoshorts/schedule'));
    assert.ok(block.includes(eveningPaths[day]));
  }
});

test("Monday owns the weekly mini-series exactly once through the daily Zernio lane", () => {
  const monday = opsSource.slice(opsSource.indexOf('"monday-am": ['), opsSource.indexOf('"tuesday-am": ['));
  assert.ok(monday.includes('/zernio/daily/monday'));
  assert.equal(monday.includes('/zernio/mini-series/weekly'), false);
  assert.match(zernioSocialSource, /laneKey === "monday"/);
  assert.match(zernioSocialSource, /buildAndScheduleWeeklyMiniSeries/);
});

test("Friday AM prepares weekend Zernio and Friday PM is podcast only", () => {
  const fridayAm = opsSource.slice(opsSource.indexOf('"friday-am": ['), opsSource.indexOf('"friday-pm": ['));
  assert.ok(fridayAm.includes('/zernio/daily/saturday'));
  assert.ok(fridayAm.includes('/zernio/daily/sunday'));
  const fridayPm = opsSource.slice(opsSource.indexOf('"friday-pm": ['), opsSource.indexOf('});', opsSource.indexOf('"friday-pm": [')));
  assert.ok(fridayPm.includes('/podcast/readiness'));
  assert.ok(fridayPm.includes('/podcast/run'));
  assert.ok(fridayPm.includes('podcast-readiness'));
  assert.equal(fridayPm.includes('/blotato/'), false);
  assert.equal(fridayPm.includes('/zernio/'), false);
});


test("operation windows poll accepted async children before completing", () => {
  assert.match(opsSource, /extractAsyncStatusUrl/);
  assert.match(opsSource, /waitForAsyncOperation/);
  assert.match(opsSource, /AIMS_OPERATION_ASYNC_JOB_TIMEOUT_MS/);
});

test("operation windows do not contain duplicate task names or paths", () => {
  assert.match(opsSource, /contains duplicate task names/);
  assert.match(opsSource, /contains duplicate task paths/);
  const fridayAm = opsSource.slice(opsSource.indexOf('"friday-am": ['), opsSource.indexOf('"friday-pm": ['));
  assert.equal((fridayAm.match(/\/blog\/social\/daily\/build/g) || []).length, 1);
  assert.equal((fridayAm.match(/\/zernio\/blog-rss\/daily/g) || []).length, 1);
});

test("Friday podcast readiness has no artificial inter-task wait", () => {
  assert.match(opsSource, /AIMS_OPERATION_FRIDAY_PM_DELAY_MS \|\| 0/);
});


test("synchronous tasks and Zernio weekly extras fail the operation window when their body reports failure", () => {
  assert.match(opsSource, /result\.partialFailure === true/);
  assert.match(opsSource, /result\.quarantined === true/);
  assert.match(zernioSocialSource, /failedExtras/);
  assert.match(zernioSocialSource, /partialFailure: daily\?\.partialFailure === true \|\| failedExtras\.length > 0/);
});


test("dependent publication steps cannot run after a failed build", () => {
  assert.match(opsSource, /Zernio blog handoff must depend on blog-social/);
  assert.match(opsSource, /newsletter readiness must depend on newsletter-generate/);
  assert.match(opsSource, /newsletter send must depend on newsletter-readiness/);
});

test("RSS-backed content never publishes from a failed morning rewrite", () => {
  assert.match(opsSource, /blog-social build must depend on rss-rewrite/);
  assert.match(opsSource, /weekly blog must depend on rss-rewrite/);
  assert.match(opsSource, /task\[0\] === "blotato-am" \|\| task\[0\] === "blotato-pm"/);
  assert.match(opsSource, /dependsOn !== "rss-rewrite"/);
});


test("long-running daily children are dispatched asynchronously with stable idempotency", () => {
  assert.match(opsSource, /ASYNC_TASK_ROUTES/);
  assert.match(opsSource, /async=true/);
  assert.match(opsSource, /x-idempotency-key/);
  assert.match(opsSource, /operation-dispatch-timeout/);
  assert.match(opsSource, /asyncStatusUrlFor/);
});
