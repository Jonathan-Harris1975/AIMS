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

test("auditForensic route supports Koyeb OpenRouter env names and legacy aliases", async () => {
  const names = [
    "OPENROUTER_ANTHROPIC_4_6",
    "OPENROUTER_API_KEY_ANTHROPIC_4_6",
    "OPENROUTER_ANTHROPIC",
    "OPENROUTER_API_KEY_ANTHROPIC",
  ];
  const oldEnv = snapshotEnv(names);

  process.env.OPENROUTER_ANTHROPIC_4_6 = "anthropic/test-model";
  process.env.OPENROUTER_API_KEY_ANTHROPIC_4_6 = "sk-or-test-value";
  delete process.env.OPENROUTER_ANTHROPIC;
  delete process.env.OPENROUTER_API_KEY_ANTHROPIC;

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?diag=${Date.now()}`);
    const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
    const providerIds = diagnostics.configuredProviders.map((provider) => provider.providerId);

    assert.equal(diagnostics.routeKey, "auditForensic");
    assert.ok(providerIds.includes("anthropic46"));
    assert.ok(providerIds.includes("anthropic"));

    const anthropic46 = diagnostics.configuredProviders.find((provider) => provider.providerId === "anthropic46");
    assert.equal(anthropic46.configured, true);
    assert.equal(anthropic46.model, "anthropic/test-model");
    assert.equal(anthropic46.modelEnv, "OPENROUTER_ANTHROPIC_4_6");
    assert.equal(anthropic46.apiKeyEnv, "OPENROUTER_API_KEY_ANTHROPIC_4_6");
  } finally {
    restoreEnv(oldEnv);
  }
});
