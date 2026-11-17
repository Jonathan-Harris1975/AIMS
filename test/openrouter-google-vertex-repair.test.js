import test from "node:test";
import assert from "node:assert/strict";
import { isGoogleTextPartAdapterFailure } from "../services/shared/utils/ai-service.js";

const googleSchemaFailure = {
  status: 400,
  bodySnippet: JSON.stringify({ error: { message: 'text content parts must carry a string "text" (got undefined)',
    code: 400, metadata: { provider_name: "Google" } } }),
};

test("only an identified Google 400 with valid outbound text permits bounded provider exclusion", () => {
  const valid = [{ role: "system", content: "Keep source evidence" }, { role: "user", content: "Prepare a mini-series" }];
  assert.equal(isGoogleTextPartAdapterFailure(googleSchemaFailure, valid), true);
  assert.equal(isGoogleTextPartAdapterFailure(googleSchemaFailure, [{ role: "user", content: [{ type: "text" }] }]), false,
    "never hide a malformed local message behind a provider fallback");
  assert.equal(isGoogleTextPartAdapterFailure({ ...googleSchemaFailure, status: 500 }, valid), false);
  assert.equal(isGoogleTextPartAdapterFailure({ ...googleSchemaFailure, bodySnippet: "irrelevant 400" }, valid), false);
  assert.equal(isGoogleTextPartAdapterFailure({ ...googleSchemaFailure,
    bodySnippet: googleSchemaFailure.bodySnippet.replace("Google", "Anthropic") }, valid), false);
});

test("Google Vertex repair retains authorised model and Headroom and cannot recurse indefinitely", async () => {
  const source = (await import("node:fs")).readFileSync(new URL("../services/shared/utils/ai-service.js", import.meta.url), "utf8");
  assert.match(source, /\^zernioMiniSeries/);
  assert.match(source, /avoidGoogleVertex = false/);
  assert.match(source, /"google-vertex"/);
  assert.match(source, /!avoidGoogleVertex &&/);
  assert.match(source, /const headroom = await compressForOpenRouter/);
});


test("a real Zernio mini-series request retries the same model once outside Google Vertex", async () => {
  const { testCredential } = await import("./helpers/testCredentials.js");
  const names = ["OPENROUTER_API_KEY", "OPENROUTER_API_BASE", "AI_MODEL_AUDIT",
    "AI_MODEL_HIGH_QUALITY", "OPENROUTER_CLAUDE_SONNET_5", "HEADROOM_ENABLED", "OPENROUTER_PROVIDER_IGNORE",
    "OPENROUTER_PROVIDER_ONLY", "OPENROUTER_ENABLE_FALLBACKS"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const requests = [];
  Object.assign(process.env, {
    OPENROUTER_API_KEY: testCredential("openrouter"),
    OPENROUTER_API_BASE: "https://openrouter.example/api/v1",
    AI_MODEL_AUDIT: "anthropic/claude-sonnet-test",
    OPENROUTER_CLAUDE_SONNET_5: "anthropic/claude-sonnet-test",
    HEADROOM_ENABLED: "false",
  });
  delete process.env.OPENROUTER_PROVIDER_IGNORE;
  delete process.env.OPENROUTER_PROVIDER_ONLY;
  delete process.env.OPENROUTER_ENABLE_FALLBACKS;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) return {
      ok: false, status: 400,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: {
        message: 'text content parts must carry a string "text" (got undefined)',
        code: 400, metadata: { provider_name: "Google" },
      } }),
    };
    return {
      ok: true, json: async () => ({
        model: "anthropic/claude-sonnet-test",
        choices: [{ finish_reason: "stop", message: { content: '{"decision":"skip"}' } }],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      }),
    };
  };
  try {
    const { resilientRequest } = await import("../services/shared/utils/ai-service.js");
    const content = await resilientRequest("zernioMiniSeriesResearch", {
      sessionId: "google-vertex-adapter-regression",
      messages: [{ role: "system", content: "Only use supplied evidence." },
        { role: "user", content: "Return one JSON object." }],
      max_tokens: 1000, maxRetries: 0, timeoutMs: 3000,
    });
    assert.equal(content, '{"decision":"skip"}');
    assert.equal(requests.length, 2, "a second request is permitted once, not an unbounded provider loop");
    assert.equal(requests[0].model, requests[1].model);
    assert.equal(requests[0].model, "anthropic/claude-sonnet-test");
    assert.deepEqual(requests[0].messages, requests[1].messages);
    assert.ok(requests[1].provider?.ignore?.includes("google-vertex"));
    assert.ok(!requests[0].provider?.ignore?.includes("google-vertex"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
