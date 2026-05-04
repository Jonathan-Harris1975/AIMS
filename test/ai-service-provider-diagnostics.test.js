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

const OPENROUTER_ENV_NAMES = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_API_KEY_ART",
  "OPENROUTER_API_KEY_ART_BACKUP",
  "OPENROUTER_ANTHROPIC",
  "OPENROUTER_API_KEY_ANTHROPIC",
  "OPENROUTER_ANTHROPIC_4-6",
  "OPENROUTER_API_KEY_ANTHROPIC_4-6",
  "OPENROUTER_ANTHROPIC_4.6",
  "OPENROUTER_API_KEY_ANTHROPIC_4.6",
  "OPENROUTER_ANTHROPIC_4_6",
  "OPENROUTER_API_KEY_ANTHROPIC_4_6",
  "OPENROUTER_GOOGLE",
  "OPENROUTER_API_KEY_GOOGLE",
  "OPENROUTER_GOOGLE_2-5_flashlite",
  "OPENROUTER_API_KEY_GOOGLE_2-5_flashlite",
  "OPENROUTER_GOOGLE_2.5_flashlite",
  "OPENROUTER_API_KEY_GOOGLE_2.5_flashlite",
  "OPENROUTER_GOOGLE_2_5_flashlite",
  "OPENROUTER_API_KEY_GOOGLE_2_5_flashlite",
  "OPENROUTER_CHATGPT",
  "OPENROUTER_API_KEY_CHATGPT",
  "OPENROUTER_CHATGPT_mini-5",
  "OPENROUTER_CHATGPT_mini5_",
  "OPENROUTER_API_KEY_CHATGPT_mini5",
  "OPENROUTER_DEEPSEEK",
  "OPENROUTER_API_KEY_DEEPSEEK",
  "OPENROUTER_DEEPSEEK_v4_pro",
  "OPENROUTER_API_KEY_DEEPSEEK_v4_pro",
  "OPENROUTER_META",
  "OPENROUTER_API_KEY_META",
];

function clearOpenRouterEnv() {
  for (const name of OPENROUTER_ENV_NAMES) delete process.env[name];
}

test("auditForensic route supports current Koyeb spreadsheet model vars with one shared OpenRouter key", async () => {
  const snapshot = snapshotEnv(OPENROUTER_ENV_NAMES);
  clearOpenRouterEnv();

  process.env.OPENROUTER_API_KEY = "sk-or-test-shared";
  process.env.OPENROUTER_ANTHROPIC_4_6 = "anthropic/claude-sonnet-4.6";
  process.env.OPENROUTER_GOOGLE_2_5_flashlite = "google/gemini-2.5-flash-lite";
  process.env.OPENROUTER_CHATGPT_mini5_ = "openai/gpt-5-mini";

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?diag=${Date.now()}-shared-key`);
    const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
    const anthropic = diagnostics.configuredProviders.find((provider) => provider.providerId === "anthropic46");
    const google = diagnostics.configuredProviders.find((provider) => provider.providerId === "google25FlashLite");
    const chatgpt = diagnostics.configuredProviders.find((provider) => provider.providerId === "chatgptMini5");

    assert.equal(diagnostics.routeKey, "auditForensic");
    assert.equal(anthropic.configured, true);
    assert.equal(anthropic.model, "anthropic/claude-sonnet-4.6");
    assert.equal(anthropic.modelEnv, "OPENROUTER_ANTHROPIC_4_6");
    assert.equal(anthropic.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(google.configured, true);
    assert.equal(google.modelEnv, "OPENROUTER_GOOGLE_2_5_flashlite");
    assert.equal(google.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(chatgpt.configured, true);
    assert.equal(chatgpt.apiKeyEnv, "OPENROUTER_API_KEY");
  } finally {
    restoreEnv(snapshot);
  }
});

test("auditForensic route supports hyphen and dot aliases from older Koyeb spreadsheet rows", async () => {
  const snapshot = snapshotEnv(OPENROUTER_ENV_NAMES);
  clearOpenRouterEnv();

  process.env["OPENROUTER_ANTHROPIC_4-6"] = "anthropic/test-model";
  process.env["OPENROUTER_API_KEY_ANTHROPIC_4.6"] = "sk-or-test-anthropic-dot";
  process.env["OPENROUTER_GOOGLE_2-5_flashlite"] = "google/test-model";
  process.env["OPENROUTER_API_KEY_GOOGLE_2.5_flashlite"] = "sk-or-test-google-dot";
  process.env["OPENROUTER_CHATGPT_mini-5"] = "openai/test-model";
  process.env.OPENROUTER_API_KEY_CHATGPT_mini5 = "sk-or-test-openai";

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?diag=${Date.now()}-aliases`);
    const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
    const anthropic = diagnostics.configuredProviders.find((provider) => provider.providerId === "anthropic46");
    const google = diagnostics.configuredProviders.find((provider) => provider.providerId === "google25FlashLite");
    const chatgpt = diagnostics.configuredProviders.find((provider) => provider.providerId === "chatgptMini5");

    assert.equal(anthropic.configured, true);
    assert.equal(anthropic.modelEnv, "OPENROUTER_ANTHROPIC_4-6");
    assert.equal(anthropic.apiKeyEnv, "OPENROUTER_API_KEY_ANTHROPIC_4.6");
    assert.equal(google.configured, true);
    assert.equal(google.modelEnv, "OPENROUTER_GOOGLE_2-5_flashlite");
    assert.equal(google.apiKeyEnv, "OPENROUTER_API_KEY_GOOGLE_2.5_flashlite");
    assert.equal(chatgpt.configured, true);
    assert.equal(chatgpt.modelEnv, "OPENROUTER_CHATGPT_mini-5");
  } finally {
    restoreEnv(snapshot);
  }
});

test("auditForensic route rejects unresolved Koyeb secret placeholders instead of calling OpenRouter with them", async () => {
  const snapshot = snapshotEnv(OPENROUTER_ENV_NAMES);
  clearOpenRouterEnv();

  process.env.OPENROUTER_DEEPSEEK = "deepseek/deepseek-chat";
  process.env.OPENROUTER_API_KEY_DEEPSEEK = "{{ secret.OPENROUTER_API_KEY_DEEPSEEK }}";

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?diag=${Date.now()}-placeholder`);
    const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
    const deepseek = diagnostics.configuredProviders.find((provider) => provider.providerId === "deepseekV4Pro");

    assert.equal(deepseek.hasModel, true);
    assert.equal(deepseek.hasApiKey, true);
    assert.equal(deepseek.unresolvedTemplate, true);
    assert.equal(deepseek.configured, false);
  } finally {
    restoreEnv(snapshot);
  }
});

test("auditForensic route skips unresolved model-specific placeholders and uses later generic real keys", async () => {
  const snapshot = snapshotEnv(OPENROUTER_ENV_NAMES);
  clearOpenRouterEnv();

  process.env.OPENROUTER_ANTHROPIC = "anthropic/claude-4.5-sonnet";
  process.env["OPENROUTER_API_KEY_ANTHROPIC_4-6"] = "{{ secret.OPENROUTER_API_KEY_ANTHROPIC_4-6 }}";
  process.env.OPENROUTER_API_KEY = "sk-or-real-shared";

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?diag=${Date.now()}-skip-placeholder`);
    const diagnostics = getProviderDiagnosticsForRoute("auditForensic");
    const anthropic = diagnostics.configuredProviders.find((provider) => provider.providerId === "anthropic46");

    assert.equal(anthropic.configured, true);
    assert.equal(anthropic.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(anthropic.unresolvedTemplate, false);
  } finally {
    restoreEnv(snapshot);
  }
});
