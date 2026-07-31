import assert from "node:assert/strict";
import test from "node:test";
import { buildPodcastCompletionStatus } from "../services/podcast/completionStatus.js";

test("podcast completion is clean only when RSS and website rebuild both confirm", () => {
  assert.deepEqual(buildPodcastCompletionStatus({ rss: { ok: true }, rebuild: { ok: true } }), {
    ok: true,
    partialFailure: false,
    issues: [],
  });
});

test("podcast publication failures are terminal partial failures for the operation window", () => {
  const report = buildPodcastCompletionStatus({
    rss: { ok: false, error: "RSS write failed" },
    rebuild: { ok: false, error: "site hook failed" },
  });
  assert.equal(report.ok, false);
  assert.equal(report.partialFailure, true);
  assert.deepEqual(report.issues.map((item) => item.stage), ["rss", "website-rebuild"]);
});
