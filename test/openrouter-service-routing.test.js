import test from "node:test";
import assert from "node:assert/strict";

const OPENROUTER_ENV_NAMES = [
  "OPENROUTER_ART_BACKUP",
  "OPENROUTER_META",
  "OPENROUTER_DEEPSEEK_v4_flash",
  "OPENROUTER_DEEPSEEK_v4_pro",
  "OPENROUTER_ANTHROPIC_4_6",
  "OPENROUTER_CHATGPT_mini5_",
  "OPENROUTER_GOOGLE_2_5_flashlite",
  "OPENROUTER_API_BASE",
  "OPENROUTER_API_KEY",
  "OPENROUTER_ART",
  "OPENROUTER_API_KEY_ART",
  "OPENROUTER_API_KEY_ART_BACKUP",
];

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function applySpreadsheetOpenRouterEnv() {
  process.env.OPENROUTER_ART_BACKUP = "openai/gpt-5-image-mini";
  process.env.OPENROUTER_META = "meta-llama/llama-4-scout";
  process.env.OPENROUTER_DEEPSEEK_v4_flash = "deepseek/deepseek-v4-flash";
  process.env.OPENROUTER_DEEPSEEK_v4_pro = "deepseek/deepseek-v4-pro";
  process.env.OPENROUTER_ANTHROPIC_4_6 = "anthropic/claude-sonnet-4.6";
  process.env.OPENROUTER_CHATGPT_mini5_ = "openai/gpt-5-mini";
  process.env.OPENROUTER_GOOGLE_2_5_flashlite = "google/gemini-2.5-flash-lite";
  process.env.OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
  process.env.OPENROUTER_API_KEY = "sk-or-global-test-value";
  process.env.OPENROUTER_ART = "google/gemini-2.5-flash-image";
  delete process.env.OPENROUTER_API_KEY_ART;
  delete process.env.OPENROUTER_API_KEY_ART_BACKUP;
}

test("OpenRouter text routes used by blog, OneUp, RSS and audits resolve spreadsheet env names", async () => {
  const oldEnv = snapshotEnv(OPENROUTER_ENV_NAMES);
  applySpreadsheetOpenRouterEnv();

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?openrouterRoutes=${Date.now()}`);
    const expectedRoutes = {
      blogWeekly: ["OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_CHATGPT_mini5_", "OPENROUTER_DEEPSEEK_v4_pro"],
      oneupDaily: ["OPENROUTER_CHATGPT_mini5_", "OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_DEEPSEEK_v4_pro"],
      oneupQuiz: ["OPENROUTER_CHATGPT_mini5_", "OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_DEEPSEEK_v4_pro"],
      rssRewrite: ["OPENROUTER_CHATGPT_mini5_", "OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_META"],
      rssShortTitle: ["OPENROUTER_CHATGPT_mini5_", "OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_META"],
      auditForensic: [
        "OPENROUTER_ANTHROPIC_4_6",
        "OPENROUTER_GOOGLE_2_5_flashlite",
        "OPENROUTER_CHATGPT_mini5_",
        "OPENROUTER_DEEPSEEK_v4_pro",
        "OPENROUTER_DEEPSEEK_v4_flash",
        "OPENROUTER_META",
      ],
    };

    for (const [routeName, modelEnvNames] of Object.entries(expectedRoutes)) {
      const diagnostics = getProviderDiagnosticsForRoute(routeName);
      const configured = diagnostics.configuredProviders.filter((provider) => provider.configured);
      assert.ok(configured.length > 0, `${routeName} should have configured OpenRouter providers`);

      for (const modelEnv of modelEnvNames) {
        assert.ok(
          configured.some((provider) => provider.modelEnv === modelEnv && provider.apiKeyEnv === "OPENROUTER_API_KEY"),
          `${routeName} should resolve ${modelEnv} with OPENROUTER_API_KEY`
        );
      }
    }
  } finally {
    restoreEnv(oldEnv);
  }
});

test("OpenRouter artwork image providers resolve through shared ai-config", async () => {
  const oldEnv = snapshotEnv(OPENROUTER_ENV_NAMES);
  applySpreadsheetOpenRouterEnv();

  try {
    const { getArtworkProviderDiagnostics } = await import(`../services/artwork/utils/openrouterProviders.js?artRoutes=${Date.now()}`);
    const diagnostics = getArtworkProviderDiagnostics();

    assert.deepEqual(
      diagnostics.map((provider) => provider.providerId),
      ["artworkPrimary", "artworkBackup"]
    );

    const primary = diagnostics.find((provider) => provider.providerId === "artworkPrimary");
    assert.equal(primary?.configured, true);
    assert.equal(primary?.modelEnv, "OPENROUTER_ART");
    assert.equal(primary?.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(primary?.model, "google/gemini-2.5-flash-image");

    const backup = diagnostics.find((provider) => provider.providerId === "artworkBackup");
    assert.equal(backup?.configured, true);
    assert.equal(backup?.modelEnv, "OPENROUTER_ART_BACKUP");
    assert.equal(backup?.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(backup?.model, "openai/gpt-5-image-mini");
  } finally {
    restoreEnv(oldEnv);
  }
});
