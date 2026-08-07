import test from "node:test";
import assert from "node:assert/strict";

function saveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("resilientRequest fails over immediately after a provider timeout", async () => {
  const names = [
    "AI_MODEL_STANDARD",
    "OPENROUTER_GOOGLE_2_5_flashlite",
    "AI_MODEL_FALLBACK",
    "OPENROUTER_API_KEY",
    "OPENROUTER_API_BASE",
  ];
  const oldEnv = saveEnv(names);
  const oldFetch = globalThis.fetch;
  let callCount = 0;

  process.env.AI_MODEL_STANDARD = "openai/slow-test-model";
  process.env.OPENROUTER_GOOGLE_2_5_flashlite = "google/fast-test-model";
  delete process.env.AI_MODEL_FALLBACK;
  process.env.OPENROUTER_API_KEY = "sk-or-test-value";
  process.env.OPENROUTER_API_BASE = "https://openrouter.example/api/v1";

  globalThis.fetch = async (_url, options = {}) => {
    callCount += 1;

    if (callCount === 1) {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        }, { once: true });
      });
    }

    return {
      ok: true,
      json: async () => ({
        model: "google/fast-test-model",
        choices: [{ message: { content: "fast provider recovered" } }],
        usage: {},
      }),
    };
  };

  try {
    const { resilientRequest } = await import(`../services/shared/utils/ai-service.js?timeoutFailover=${Date.now()}`);
    const result = await resilientRequest("scriptMain", {
      sessionId: "timeout-failover-test",
      messages: [{ role: "user", content: "Test failover" }],
      timeoutMs: 20,
      maxRetries: 2,
    });

    assert.equal(result, "fast provider recovered");
    assert.equal(callCount, 2, "timed-out provider should not be retried before failover");
  } finally {
    restoreEnv(oldEnv);
    globalThis.fetch = oldFetch;
  }
});
