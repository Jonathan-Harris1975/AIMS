import test from "node:test";
import assert from "node:assert/strict";

test("auditForensic route uses existing shared OpenRouter env names", async () => {
  const oldModel = process.env.OPENROUTER_ANTHROPIC;
  const oldKey = process.env.OPENROUTER_API_KEY_ANTHROPIC;
  process.env.OPENROUTER_ANTHROPIC = "anthropic/test-model";
  process.env.OPENROUTER_API_KEY_ANTHROPIC = "test-key";

  try {
    const { aiConfig } = await import(`../services/shared/utils/ai-config.js?cacheBust=${Date.now()}`);
    assert.deepEqual(aiConfig.routeModels.auditForensic, ["anthropic", "google", "chatgpt", "deepseek"]);
    assert.equal(aiConfig.models.anthropic.providerId, "anthropic");
    assert.equal(aiConfig.models.anthropic.modelEnv, "OPENROUTER_ANTHROPIC");
    assert.equal(aiConfig.models.anthropic.apiKeyEnv, "OPENROUTER_API_KEY_ANTHROPIC");
    assert.equal(aiConfig.models.anthropic.name, "anthropic/test-model");
    assert.equal(aiConfig.models.anthropic.apiKey, "test-key");
  } finally {
    if (oldModel === undefined) delete process.env.OPENROUTER_ANTHROPIC;
    else process.env.OPENROUTER_ANTHROPIC = oldModel;
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY_ANTHROPIC;
    else process.env.OPENROUTER_API_KEY_ANTHROPIC = oldKey;
  }
});
