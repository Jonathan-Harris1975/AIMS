import assert from "node:assert/strict";
import test from "node:test";
import {
  assessAsyncOperationPayload,
  assessAsyncTaskOutcome,
  extractAsyncStatusUrl,
  waitForAsyncOperation,
} from "../services/ops/asyncOperation.js";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

test("async operation helpers recognise podcast and Blotato status URLs", () => {
  assert.equal(extractAsyncStatusUrl({ statusUrl: "/podcast/status/TT-1" }), "/podcast/status/TT-1");
  assert.equal(extractAsyncStatusUrl({ job: { statusUrl: "/blotato/jobs/BLT-1" } }), "/blotato/jobs/BLT-1");
});

test("operation waits until an accepted child job completes", async () => {
  const payloads = [
    { ok: true, job: { status: "running" } },
    { ok: true, job: { status: "completed", result: { ok: true } } },
  ];
  const result = await waitForAsyncOperation({
    baseUrl: "http://127.0.0.1:8000",
    statusUrl: "/podcast/status/TT-1",
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    fetchImpl: async () => response(payloads.shift()),
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.polls, 2);
});

test("completed child jobs with a failed result fail the operation window", () => {
  const assessment = assessAsyncOperationPayload({
    job: { status: "completed", result: { ok: false, quarantined: true } },
  });
  assert.equal(assessment.terminal, true);
  assert.equal(assessment.ok, false);
});

test("failed child jobs fail closed", async () => {
  const result = await waitForAsyncOperation({
    baseUrl: "http://127.0.0.1:8000",
    statusUrl: "/blotato/jobs/BLT-1",
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    fetchImpl: async () => response({ ok: true, job: { status: "failed", error: { message: "render failed" } } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
});

test("completed podcast jobs with publication partial failures fail the operation window", () => {
  const assessment = assessAsyncOperationPayload({
    job: { status: "completed", result: { ok: false, partialFailure: true, issues: [{ stage: "rss" }] } },
  });
  assert.equal(assessment.terminal, true);
  assert.equal(assessment.ok, false);
});


test("partially published Blotato jobs fail the operation window", () => {
  const assessment = assessAsyncOperationPayload({
    job: { status: "completed", result: { partial: true, failedPublishes: [{ platform: "youtube" }] } },
  });
  assert.equal(assessment.terminal, true);
  assert.equal(assessment.ok, false);
});

test("operation polling survives a short-lived 404 before the durable child job appears", async () => {
  let attempt = 0;
  const result = await waitForAsyncOperation({
    baseUrl: "http://127.0.0.1:8000",
    statusUrl: "/zernio/jobs/daily-monday/ops-1",
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    notFoundGraceMs: 500,
    maxConsecutiveErrors: 3,
    fetchImpl: async () => {
      attempt += 1;
      if (attempt === 1) return response({ ok: false, error: "not found" }, 404);
      return response({ ok: true, status: "completed", result: { ok: true } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.pollErrors, 1);
  assert.equal(result.polls, 1);
});


test("published podcast episodes do not rerun for post-publication reconciliation failures", () => {
  const outcome = assessAsyncTaskOutcome("/podcast/run", {
    status: "completed",
    ok: false,
    result: {
      partialFailure: true,
      rss: {
        ok: true,
        result: { ok: true, episode: { url: "https://example.test/podcast/episode-1.mp3" } },
      },
      issues: [{ stage: "website-rebuild", error: "hook unavailable" }],
    },
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.warning, true);
  assert.equal(outcome.nonRetryablePartialPublication, true);
  assert.equal(outcome.episodeUrl, "https://example.test/podcast/episode-1.mp3");
});

test("podcast RSS or pre-publication failures still fail the operation window", () => {
  const rssFailure = assessAsyncTaskOutcome("/podcast/run", {
    status: "completed",
    ok: false,
    result: {
      partialFailure: true,
      rss: { ok: false, result: { ok: false } },
      issues: [{ stage: "rss", error: "publish failed" }],
    },
  });
  assert.equal(rssFailure.ok, false);

  const prePublicationFailure = assessAsyncTaskOutcome("/podcast/run", {
    status: "completed",
    ok: false,
    result: {
      partialFailure: true,
      rss: {
        ok: true,
        result: { ok: true, episode: { url: "https://example.test/podcast/episode-1.mp3" } },
      },
      issues: [{ stage: "artwork", error: "render failed" }],
    },
  });
  assert.equal(prePublicationFailure.ok, false);
});
