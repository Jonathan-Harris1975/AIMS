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
  const mod = await import(`../services/shared/utils/jobStore.js?case=running-${Date.now()}`);

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
  const mod = await import(`../services/shared/utils/jobStore.js?case=rerun-${Date.now()}`);

  const first = mod.beginJob("podcast", "TT-jobstore-complete", { route: "test" });
  assert.equal(first.started, true);
  mod.completeJob("podcast", "TT-jobstore-complete", { result: { ok: true } });

  const second = mod.beginJob("podcast", "TT-jobstore-complete", { route: "test" });
  assert.equal(second.started, true);
  assert.equal(second.job.status, "running");
  assert.equal(second.job.attempt, 2);
});
