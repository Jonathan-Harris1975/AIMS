import test from "node:test";
import assert from "node:assert/strict";
import { testCredential } from "./helpers/testCredentials.js";

function saveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("resilientRequest honours audit maxRetries=0 and masks provider error body", async () => {
  const names = [
    "OPENROUTER_ANTHROPIC",
    "OPENROUTER_API_KEY_ANTHROPIC",
    "OPENROUTER_GOOGLE",
    "OPENROUTER_API_KEY_GOOGLE",
    "OPENROUTER_CHATGPT",
    "OPENROUTER_API_KEY_CHATGPT",
    "OPENROUTER_DEEPSEEK",
    "OPENROUTER_API_KEY_DEEPSEEK",
    "OPENROUTER_API_BASE",
  ];
  const oldEnv = saveEnv(names);
  const oldFetch = globalThis.fetch;
  let callCount = 0;

  process.env.OPENROUTER_ANTHROPIC = "anthropic/test-model";
  process.env.OPENROUTER_API_KEY_ANTHROPIC = testCredential("openrouter-anthropic");
  delete process.env.OPENROUTER_GOOGLE;
  delete process.env.OPENROUTER_API_KEY_GOOGLE;
  delete process.env.OPENROUTER_CHATGPT;
  delete process.env.OPENROUTER_API_KEY_CHATGPT;
  delete process.env.OPENROUTER_DEEPSEEK;
  delete process.env.OPENROUTER_API_KEY_DEEPSEEK;
  process.env.OPENROUTER_API_BASE = "https://openrouter.example/api/v1";

  globalThis.fetch = async () => {
    callCount += 1;
    return {
      ok: false,
      status: 400,
      text: async () => "bad request sk-or-secret-value",
    };
  };

  try {
    const { resilientRequest } = await import(`../services/shared/utils/ai-service.js?auditMaxRetries=${Date.now()}`);
    await assert.rejects(
      resilientRequest("auditForensic", {
        messages: [{ role: "user", content: "Return JSON" }],
        maxRetries: 0,
        timeoutMs: 1000,
      }),
      (err) => {
        assert.equal(err.name, "AIProviderRequestError");
        assert.equal(err.status, 400);
        assert.equal(err.bodySnippet.includes("sk-or-secret-value"), false);
        return true;
      }
    );
    assert.equal(callCount, 1);
  } finally {
    restoreEnv(oldEnv);
    globalThis.fetch = oldFetch;
  }
});
