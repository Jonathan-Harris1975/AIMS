import test from "node:test";
import assert from "node:assert/strict";
import { podcastPipelineSucceeded } from "../services/podcast/pipelineOutcome.js";

test("only a confirmed RSS and website publication completes the podcast job", () => {
  assert.equal(podcastPipelineSucceeded({ ok: true, rss: { ok: true }, rebuild: { ok: true } }), true);
  assert.equal(podcastPipelineSucceeded({ ok: false, reason: "PODCAST_INSUFFICIENT_SOURCE" }), false);
  assert.equal(podcastPipelineSucceeded({ ok: true, partialFailure: true, rss: { ok: true }, rebuild: { ok: false } }), false);
  assert.equal(podcastPipelineSucceeded({ ok: true, rss: { ok: false }, rebuild: { ok: true } }), false);
  assert.equal(podcastPipelineSucceeded(null), false);
});
