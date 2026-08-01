import test from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function restore() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) process.env[key] = value;
  globalThis.fetch = ORIGINAL_FETCH;
}

test.afterEach(restore);

test("website audit fails fast when RAMS handoff credentials are absent", async () => {
  process.env.WEBSITE_AUDIT_TRIGGER_RAMS = "true";
  delete process.env.RAMS_API_KEY;
  delete process.env.RMS_API_KEY;
  const { assertRamsWebsiteDispatchConfigured } = await import(`../audits/utils/ramsWebsiteDispatch.js?missing=${Date.now()}`);
  assert.throws(() => assertRamsWebsiteDispatchConfigured(), /RAMS_API_KEY or RMS_API_KEY is not configured/);
});

test("AIMS waits for the RAMS website report before completing the handoff", async () => {
  let polls = 0;
  globalThis.fetch = async () => {
    polls += 1;
    if (polls === 1) {
      return new Response(JSON.stringify({ status: "pending" }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      runId: "2026-08-01T15-30-00Z",
      pipeline: "website",
      finishedAt: "2026-08-01T16:10:00Z",
      issuesTotal: 3,
      issuesApplied: 2,
      issuesReverted: 0,
      issuesSkipped: 1,
      issuesManualReview: 0,
      branch: "rms-qa/website/2026-08-01",
      error: null,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const { __ramsWebsiteDispatchTestHooks } = await import(`../audits/utils/ramsWebsiteDispatch.js?wait=${Date.now()}`);
  const result = await __ramsWebsiteDispatchTestHooks.waitForRamsRunCompletion({
    config: {
      baseUrl: "https://mod.example.test",
      apiKey: "test-key",
      timeoutMs: 1000,
      completionPollIntervalMs: 1,
      completionTimeoutMs: 1000,
    },
    runId: "2026-08-01T15-30-00Z",
    sessionId: "website-2026-08-01",
    auditJsonKey: "audits/website/2026-08/website-2026-08-01/website-audit.json",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.issuesApplied, 2);
  assert.equal(polls, 2);
});
