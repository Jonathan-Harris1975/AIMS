import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function makeStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-management-suite-jobstore-"));
}

test("beginJob prevents concurrent reuse of the same running job", async () => {
  process.env.APP_STATE_DIR = makeStateDir();
  const mod = await import(`./services/shared/utils/jobStore.js?case=running-${Date.now()}`);

  const first = mod.beginJob("tts", "TT-jobstore-running", { route: "test" });
  assert.equal(first.started, true);
  assert.equal(first.job.status, "running");
  assert.equal(first.job.attempt, 1);

  const second = mod.beginJob("tts", "TT-jobstore-running", { route: "test" });
  assert.equal(second.started, false);
  assert.equal(second.job.status, "running");
  assert.equal(second.job.attempt, 1);
});

test("beginJob allows a rerun after completion and increments attempt count", async () => {
  process.env.APP_STATE_DIR = makeStateDir();
  const mod = await import(`./services/shared/utils/jobStore.js?case=rerun-${Date.now()}`);

  const first = mod.beginJob("podcast", "TT-jobstore-complete", { route: "test" });
  assert.equal(first.started, true);
  mod.completeJob("podcast", "TT-jobstore-complete", { result: { ok: true } });

  const second = mod.beginJob("podcast", "TT-jobstore-complete", { route: "test" });
  assert.equal(second.started, true);
  assert.equal(second.job.status, "running");
  assert.equal(second.job.attempt, 2);
});


test("getMostRecentActiveJobFresh is exported and returns the active job after fresh state hydration", async () => {
  process.env.APP_STATE_DIR = makeStateDir();
  const mod = await import(`./services/shared/utils/jobStore.js?case=active-fresh-${Date.now()}`);

  mod.queueJob("audit:seo-aeo-geo", "AUD-jobstore-active", { reportPrefix: "audits/test" });

  assert.equal(typeof mod.getMostRecentActiveJobFresh, "function");
  const active = await mod.getMostRecentActiveJobFresh("audit:seo-aeo-geo", { maxAgeMs: 60_000 });
  assert.equal(active.sessionId, "AUD-jobstore-active");
  assert.equal(active.status, "queued");
});


test("retrying a failed podcast clears the previous error while preserving the new event ID", async () => {
  process.env.APP_STATE_DIR = makeStateDir();
  const mod = await import(`./services/shared/utils/jobStore.js?case=failed-retry-${Date.now()}`);
  mod.beginJob("podcast", "TT-failed-retry", { eventId: "first-attempt" });
  mod.failJob("podcast", "TT-failed-retry", new Error("Polly denied"));
  const next = mod.beginJob("podcast", "TT-failed-retry", { eventId: "second-attempt" });
  assert.equal(next.started, true);
  assert.equal(next.job.status, "running");
  assert.equal(next.job.attempt, 2);
  assert.equal(next.job.eventId, "second-attempt");
  assert.equal(next.job.error, undefined);
});
