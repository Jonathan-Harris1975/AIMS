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

test("resilientRequest retries the same model once with relaxed parameters after a compatibility 404", async () => {
  const names = [
    "AI_MODEL_STANDARD",
    "AI_MODEL_FAST",
    "AI_MODEL_FALLBACK",
    "OPENROUTER_API_KEY",
    "OPENROUTER_API_BASE",
    "OPENROUTER_REQUIRE_PARAMETERS",
    "OPENROUTER_REQUIRE_PARAMETERS_FOR_JSON",
    "OPENROUTER_REASONING_EFFORT",
  ];
  const oldEnv = saveEnv(names);
  const oldFetch = globalThis.fetch;
  const payloads = [];

  process.env.AI_MODEL_STANDARD = "openai/gpt-5.6-test";
  delete process.env.AI_MODEL_FAST;
  delete process.env.AI_MODEL_FALLBACK;
  process.env.OPENROUTER_API_KEY = testCredential("openrouter");
  process.env.OPENROUTER_API_BASE = "https://openrouter.example/api/v1";
  process.env.OPENROUTER_REQUIRE_PARAMETERS_FOR_JSON = "true";
  process.env.OPENROUTER_REASONING_EFFORT = "low";

  globalThis.fetch = async (_url, options = {}) => {
    payloads.push(JSON.parse(options.body));
    if (payloads.length === 1) {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({
          error: { message: "No endpoints found that can handle requested parameters" },
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({
        model: "openai/gpt-5.6-test",
        choices: [{ message: { content: "relaxed request recovered" } }],
        usage: {},
      }),
    };
  };

  try {
    const { resilientRequest } = await import(`../services/shared/utils/ai-service.js?parameterRelaxation=${Date.now()}`);
    const result = await resilientRequest("main", {
      sessionId: "parameter-relaxation-test",
      messages: [{ role: "user", content: "Return JSON" }],
      response_format: { type: "json_object" },
      maxRetries: 0,
      timeoutMs: 1000,
    });

    assert.equal(result, "relaxed request recovered");
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads[0].response_format, { type: "json_object" });
    assert.equal(payloads[0].provider?.require_parameters, true);
    assert.deepEqual(payloads[0].reasoning, { effort: "low" });
    assert.equal(Object.hasOwn(payloads[1], "response_format"), false);
    assert.equal(Object.hasOwn(payloads[1], "provider"), false);
    assert.equal(Object.hasOwn(payloads[1], "reasoning"), false);
    assert.equal(Object.hasOwn(payloads[1], "temperature"), false);
    assert.equal(Object.hasOwn(payloads[1], "top_p"), false);
  } finally {
    restoreEnv(oldEnv);
    globalThis.fetch = oldFetch;
  }
});
