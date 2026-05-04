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

test("auditForensic route works with the spreadsheet global OpenRouter API key", async () => {
  const names = [
    "OPENROUTER_API_KEY",
    "OPENROUTER_ANTHROPIC_4_6",
    "OPENROUTER_GOOGLE_2_5_flashlite",
    "OPENROUTER_CHATGPT_mini5_",
    "OPENROUTER_DEEPSEEK_v4_pro",
    "OPENROUTER_DEEPSEEK_v4_flash",
    "OPENROUTER_META",
    "OPENROUTER_API_KEY_ANTHROPIC_4_6",
    "OPENROUTER_API_KEY_GOOGLE_2_5_flashlite",
    "OPENROUTER_API_KEY_CHATGPT_mini5",
    "OPENROUTER_API_KEY_DEEPSEEK_v4_pro",
    "OPENROUTER_API_KEY_DEEPSEEK_v4_flash",
    "OPENROUTER_API_KEY_META",
  ];
  const oldEnv = snapshotEnv(names);

  process.env.OPENROUTER_API_KEY = "sk-or-global-test-value";
  process.env.OPENROUTER_ANTHROPIC_4_6 = "anthropic/test-model";
  process.env.OPENROUTER_GOOGLE_2_5_flashlite = "google/test-model";
  process.env.OPENROUTER_CHATGPT_mini5_ = "openai/test-model";
  process.env.OPENROUTER_DEEPSEEK_v4_pro = "deepseek/test-pro";
  process.env.OPENROUTER_DEEPSEEK_v4_flash = "deepseek/test-flash";
  process.env.OPENROUTER_META = "meta/test-model";

  delete process.env.OPENROUTER_API_KEY_ANTHROPIC_4_6;
  delete process.env.OPENROUTER_API_KEY_GOOGLE_2_5_flashlite;
  delete process.env.OPENROUTER_API_KEY_CHATGPT_mini5;
  delete process.env.OPENROUTER_API_KEY_DEEPSEEK_v4_pro;
  delete process.env.OPENROUTER_API_KEY_DEEPSEEK_v4_flash;
  delete process.env.OPENROUTER_API_KEY_META;

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?diagGlobal=${Date.now()}`);
    const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
    const providerIds = [
      "anthropic46",
      "google25FlashLite",
      "chatgptMini5",
      "deepseekV4Pro",
      "deepseekV4Flash",
      "meta",
    ];

    for (const providerId of providerIds) {
      const provider = diagnostics.configuredProviders.find((item) => item.providerId === providerId);
      assert.equal(provider?.configured, true, `${providerId} should use OPENROUTER_API_KEY fallback`);
      assert.equal(provider?.apiKeyEnv, "OPENROUTER_API_KEY");
    }
  } finally {
    restoreEnv(oldEnv);
  }
});
