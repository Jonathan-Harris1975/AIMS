import test from "node:test";
import assert from "node:assert/strict";

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("resilientRequest propagates caller abort signal and does not retry a cancelled OpenRouter request", async () => {
  const names = ["HEADROOM_ENABLED", "AI_MODEL_STANDARD", "OPENROUTER_API_KEY", "OPENROUTER_API_BASE", "OPENROUTER_BASE_URL"];
  const snapshot = snapshotEnv(names);
  const oldFetch = globalThis.fetch;
  process.env.HEADROOM_ENABLED = "false";
  process.env.AI_MODEL_STANDARD = "openai/test-model";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.OPENROUTER_API_BASE = "http://openrouter.test/api/v1";
  delete process.env.OPENROUTER_BASE_URL;

  let calls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    calls += 1;
    return await new Promise((resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(options.signal.reason || Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  };

  const controller = new AbortController();
  const reason = new Error("caller cancelled visual QA");

  try {
    const { resilientRequest } = await import(`../services/shared/utils/ai-service.js?abortSignal=${Date.now()}`);
    const pending = resilientRequest("main", {
      sessionId: "abort-test",
      messages: [{ role: "user", content: "cancel me" }],
      signal: controller.signal,
      timeoutMs: 5000,
      maxRetries: 4,
    });
    setTimeout(() => controller.abort(reason), 10);
    await assert.rejects(pending, (error) => error === reason);
    assert.equal(calls, 1);
  } finally {
    restoreEnv(snapshot);
    globalThis.fetch = oldFetch;
  }
});
