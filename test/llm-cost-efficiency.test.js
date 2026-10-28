import test from "node:test";
import assert from "node:assert/strict";
import { createValidatedResultCache, qaFingerprint } from "../services/shared/utils/validatedResultCache.js";
import { createRepairHistory, withRepairHistory, prepareRepairRequest } from "../services/shared/utils/repairHistory.js";

test("QA reuse stores only real approvals, clones results, expires and bounds entries", () => {
  let time = 0;
  const cache = createValidatedResultCache({ now: () => time, ttlMs: 10, maxEntries: 1 });
  cache.put("failure", { pass: false });
  cache.put("skipped", { pass: true, skipped: true });
  assert.equal(cache.get("failure"), null);
  assert.equal(cache.get("skipped"), null);
  cache.put("ok", { pass: true, defects: [] });
  cache.get("ok").defects.push("mutation");
  assert.deepEqual(cache.get("ok").defects, []);
  cache.put("new", { pass: true });
  assert.equal(cache.get("ok"), null);
  time = 10;
  assert.equal(cache.get("new"), null);
  assert.notEqual(qaFingerprint({ image: "a", threshold: 80 }), qaFingerprint({ image: "a", threshold: 90 }));
});

test("repair history follows stages, isolates concurrent artefacts and preserves source messages", async () => {
  const messages = [{ role: "user", content: "source evidence" }];
  const first = createRepairHistory();
  await withRepairHistory(first, { stage: "format" }, async () => {
    prepareRepairRequest("rssRewrite", messages).complete("candidate", "returned");
    await withRepairHistory(first, { stage: "phase3" }, async () => {
      const request = prepareRepairRequest("rssRewrite", messages);
      assert.match(request.messages.at(-1).content, /format/);
      assert.match(request.messages.at(-1).content, /never factual source evidence/);
      assert.deepEqual(request.messages[0], messages[0]);
    });
  });
  await withRepairHistory(createRepairHistory(), { stage: "other" }, async () => {
    assert.deepEqual(prepareRepairRequest("rssRewrite", messages).messages, messages);
  });
  await Promise.all(["left", "right"].map(stage => withRepairHistory(createRepairHistory(), { stage }, async () => {
    prepareRepairRequest("rssRewrite", messages).complete(stage, "returned");
    await Promise.resolve();
    const history = prepareRepairRequest("rssRewrite", messages).messages.at(-1).content;
    assert.match(history, new RegExp(stage));
    assert.doesNotMatch(history, new RegExp(stage === "left" ? "right" : "left"));
  })));
  assert.equal(messages.length, 1);
});

test("returned empty and invalid attempts are accounted once before fallback", async () => {
  const logs = [];
  globalThis.__AI_PODCAST_LOGGER__ = Object.fromEntries(["info", "error", "warn", "debug"].map(name => [name, (...args) => logs.push(args)]));
  Object.assign(process.env, {
    OPENROUTER_API_KEY: "test-only", AI_MODEL_FAST: "economy", AI_MODEL_SUMMARY: "economy",
    AI_MODEL_STANDARD: "paid-check", AI_MAX_RETRIES: "0", HEADROOM_ENABLED: "false", AI_USAGE_LOG_ENABLED: "true",
  });
  const priorFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ({ ok: true, json: async () => {
    calls += 1;
    return { id: `response-${calls}`, model: calls % 2 ? "economy" : "paid-check",
      choices: [{ message: { content: calls === 1 ? "" : calls === 3 ? "maybe" : "yes" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 10, cost: 0.01 } };
  } });
  try {
    const { resilientRequest } = await import("../services/shared/utils/ai-service.js");
    const options = { sessionId: "cost-test", messages: [{ role: "user", content: "classify" }], maxRetries: 0,
      validateContent(content) { if (content !== "yes") { const error = new Error("invalid"); error.code = "AI_INVALID_STRUCTURED_OUTPUT"; throw error; } } };
    assert.equal(await resilientRequest("rssRelevance", options), "yes");
    assert.equal(await resilientRequest("rssRelevance", options), "yes");
    const usage = logs.filter(args => args.includes("ai.request.usage")).map(args => args.find(value => value && typeof value === "object"));
    assert.equal(usage.length, 4);
    assert.equal(new Set(usage.map(x => x.responseId)).size, 4);
    assert.equal(usage.reduce((sum, x) => sum + x.cost, 0), 0.04);
    assert.ok(usage.every(x => x.sessionId === "cost-test"));
  } finally { globalThis.fetch = priorFetch; }
});

test("artwork QA reuses exact approvals and invalidates changed evidence, models and thresholds", async () => {
  process.env.OPENROUTER_CLAUDE_SONNET_5 = "vision-a";
  const priorFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      score: 99, relevance: 99, textSafety: 100, composition: 99, brandFit: 99,
      defects: [], hardDefects: [], summary: "Relevant and legible",
    }) } }] }) };
  };
  try {
    const { auditArtworkBase64 } = await import("../services/artwork/utils/artworkVisualQa.js");
    const options = { base64: Buffer.from("image-a").toString("base64"), creativePrompt: "AI governance", mode: "cache-test" };
    assert.equal((await auditArtworkBase64(options)).pass, true);
    assert.equal((await auditArtworkBase64(options)).pass, true);
    assert.equal(calls, 1);
    await auditArtworkBase64({ ...options, creativePrompt: "AI agents" });
    assert.equal(calls, 2);
    await auditArtworkBase64({ ...options, base64: Buffer.from("image-b").toString("base64") });
    assert.equal(calls, 3);
    process.env.OPENROUTER_CLAUDE_SONNET_5 = "vision-b";
    await auditArtworkBase64(options);
    assert.equal(calls, 4);
    process.env.CACHE_TEST_ARTWORK_VISUAL_QA_THRESHOLD = "98";
    await auditArtworkBase64(options);
    assert.equal(calls, 5);
  } finally {
    globalThis.fetch = priorFetch;
    delete process.env.CACHE_TEST_ARTWORK_VISUAL_QA_THRESHOLD;
  }
});

test("RSS classifier uses economy first and escalates malformed output without treating it as rejection", async () => {
  const priorFetch = globalThis.fetch;
  const models = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    models.push(payload.model);
    assert.deepEqual(payload.reasoning, { effort: "none", exclude: true });
    assert.equal(payload.max_completion_tokens, 64);
    return { ok: true, json: async () => ({ choices: [{ message: { content: models.length === 1 ? "maybe" : "yes" } }] }) };
  };
  try {
    const { isAIRelevant } = await import("../services/rss-feed-creator/utils/filterAIContent.js");
    assert.equal(await isAIRelevant({ title: "OpenAI library", description: "OpenAI library adds a large language model interface for developers." }), true);
    assert.deepEqual(models, ["economy", "paid-check"]);
    assert.equal(await isAIRelevant({ title: "Solar power", description: "Solar power and AI" }), false);
    assert.equal(models.length, 2);
  } finally { globalThis.fetch = priorFetch; }
});
