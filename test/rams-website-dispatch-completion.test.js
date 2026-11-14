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

test("AIMS persists pending RAMS work instead of an in-memory report waiter", async () => {
  let polls = 0;
  globalThis.fetch = async () => { polls += 1; return new Response('{}', { status: 202 }); };
  const { __ramsWebsiteDispatchTestHooks } = await import('../audits/utils/ramsWebsiteDispatch.js');
  const result = await __ramsWebsiteDispatchTestHooks.waitForRamsRunCompletion({
    config: { baseUrl: "https://mod.example.test", apiKey: "test-key", timeoutMs: 1000 }, runId: "run-1",
  });
  assert.equal(result.status, "pending");
  assert.equal(polls, 1);
});
