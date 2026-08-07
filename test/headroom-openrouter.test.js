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

const HEADROOM_ENV = [
  "HEADROOM_ENABLED",
  "HEADROOM_BASE_URL",
  "HEADROOM_API_KEY",
  "HEADROOM_PROXY_TOKEN",
  "HEADROOM_TIMEOUT_MS",
  "HEADROOM_MIN_INPUT_CHARS",
  "HEADROOM_TARGET_RATIO",
  "HEADROOM_PROTECT_RECENT",
  "HEADROOM_COMPRESS_USER_MESSAGES",
  "HEADROOM_LOG_SAVINGS",
  "HEADROOM_ROUTES",
];

test("Headroom compresses eligible text-only messages and preserves system messages", async () => {
  const snapshot = snapshotEnv(HEADROOM_ENV);
  const oldFetch = globalThis.fetch;
  process.env.HEADROOM_ENABLED = "true";
  process.env.HEADROOM_BASE_URL = "http://headroom.test:8787";
  process.env.HEADROOM_MIN_INPUT_CHARS = "1";
  process.env.HEADROOM_ROUTES = "scriptMain";
  process.env.HEADROOM_LOG_SAVINGS = "false";

  const original = [
    { role: "system", content: "Keep this exact." },
    { role: "user", content: "Long source material ".repeat(100) },
  ];
  let request;
  globalThis.fetch = async (url, options = {}) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        messages: [original[0], { role: "user", content: "Compressed source material." }],
        tokens_before: 500,
        tokens_after: 180,
        tokens_saved: 320,
        compression_ratio: 0.36,
        transforms_applied: ["router:test"],
      }),
    };
  };

  try {
    const { compressForOpenRouter } = await import(`../services/shared/utils/headroom.js?compress=${Date.now()}`);
    const result = await compressForOpenRouter({
      routeName: "scriptMain-1",
      routeKey: "scriptMain",
      model: "openai/gpt-5.6-luna",
      messages: original,
    });

    assert.equal(request.url, "http://headroom.test:8787/v1/compress");
    assert.equal(request.body.model, "openai/gpt-5.6-luna");
    assert.equal(request.body.config.compress_user_messages, true);
    assert.deepEqual(result.messages[0], original[0]);
    assert.equal(result.messages[1].content, "Compressed source material.");
    assert.equal(result.compressed, true);
    assert.equal(result.tokensSaved, 320);
  } finally {
    restoreEnv(snapshot);
    globalThis.fetch = oldFetch;
  }
});

test("Headroom rejects unsafe system-message changes and fails open", async () => {
  const snapshot = snapshotEnv(HEADROOM_ENV);
  const oldFetch = globalThis.fetch;
  process.env.HEADROOM_ENABLED = "true";
  process.env.HEADROOM_BASE_URL = "http://headroom.test:8787/v1";
  process.env.HEADROOM_MIN_INPUT_CHARS = "1";
  process.env.HEADROOM_ROUTES = "scriptMain";
  process.env.HEADROOM_LOG_SAVINGS = "false";

  const original = [
    { role: "system", content: "Do not alter this instruction." },
    { role: "user", content: "Source ".repeat(100) },
  ];
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      messages: [
        { role: "system", content: "Changed instruction." },
        { role: "user", content: "compressed" },
      ],
      tokens_before: 400,
      tokens_after: 100,
      tokens_saved: 300,
      compression_ratio: 0.25,
    }),
  });

  try {
    const { compressForOpenRouter } = await import(`../services/shared/utils/headroom.js?unsafe=${Date.now()}`);
    const result = await compressForOpenRouter({ routeName: "scriptMain", routeKey: "scriptMain", model: "test/model", messages: original });
    assert.equal(result.compressed, false);
    assert.equal(result.reason, "unsafe-message-change");
    assert.deepEqual(result.messages, original);
  } finally {
    restoreEnv(snapshot);
    globalThis.fetch = oldFetch;
  }
});

test("Headroom bypasses multimodal visual QA without making a compression request", async () => {
  const snapshot = snapshotEnv(HEADROOM_ENV);
  const oldFetch = globalThis.fetch;
  process.env.HEADROOM_ENABLED = "true";
  process.env.HEADROOM_BASE_URL = "http://headroom.test:8787";
  process.env.HEADROOM_MIN_INPUT_CHARS = "1";
  process.env.HEADROOM_ROUTES = "artworkVisualQa";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("must not be called"); };

  const messages = [{ role: "user", content: [{ type: "text", text: "audit" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }];

  try {
    const { compressForOpenRouter } = await import(`../services/shared/utils/headroom.js?multimodal=${Date.now()}`);
    const result = await compressForOpenRouter({ routeName: "artworkVisualQa", routeKey: "artworkVisualQa", model: "test/model", messages });
    assert.equal(result.compressed, false);
    assert.equal(result.reason, "hard-bypass-route");
    assert.equal(calls, 0);
  } finally {
    restoreEnv(snapshot);
    globalThis.fetch = oldFetch;
  }
});

test("shared OpenRouter service forwards Headroom-compressed messages", async () => {
  const names = [...HEADROOM_ENV, "AI_MODEL_STANDARD", "OPENROUTER_API_KEY", "OPENROUTER_API_BASE", "OPENROUTER_BASE_URL"];
  const snapshot = snapshotEnv(names);
  const oldFetch = globalThis.fetch;
  process.env.HEADROOM_ENABLED = "true";
  process.env.HEADROOM_BASE_URL = "http://headroom.test:8787";
  process.env.HEADROOM_MIN_INPUT_CHARS = "1";
  process.env.HEADROOM_ROUTES = "main";
  process.env.HEADROOM_LOG_SAVINGS = "false";
  process.env.AI_MODEL_STANDARD = "openai/test-model";
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.OPENROUTER_API_BASE = "http://openrouter.test/api/v1";
  delete process.env.OPENROUTER_BASE_URL;

  const seen = [];
  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body);
    seen.push({ url, body });
    if (String(url).includes("headroom.test")) {
      return {
        ok: true,
        json: async () => ({
          messages: [{ role: "user", content: "compressed payload" }],
          tokens_before: 300,
          tokens_after: 90,
          tokens_saved: 210,
          compression_ratio: 0.3,
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        model: "openai/test-model",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 90, completion_tokens: 1, total_tokens: 91 },
      }),
    };
  };

  try {
    const { resilientRequest } = await import(`../services/shared/utils/ai-service.js?headroomIntegration=${Date.now()}`);
    const result = await resilientRequest("main", {
      sessionId: "headroom-integration",
      messages: [{ role: "user", content: "original payload ".repeat(100) }],
      maxRetries: 0,
      returnMetadata: true,
    });

    assert.equal(result.content, "ok");
    assert.equal(result.headroom.compressed, true);
    assert.equal(result.headroom.tokensSaved, 210);
    assert.equal(seen.length, 2);
    assert.match(seen[0].url, /headroom\.test/);
    assert.match(seen[1].url, /openrouter\.test/);
    assert.equal(seen[1].body.messages[0].content, "compressed payload");
  } finally {
    restoreEnv(snapshot);
    globalThis.fetch = oldFetch;
  }
});
