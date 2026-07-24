import test from "node:test";
import assert from "node:assert/strict";

const OPENROUTER_ENV_NAMES = [
  "OPENROUTER_ART_BACKUP",
  "OPENROUTER_META",
  "OPENROUTER_DEEPSEEK_v4_flash",
  "OPENROUTER_DEEPSEEK_v4_pro",
  "OPENROUTER_ANTHROPIC_4_6",
  "OPENROUTER_GPT_5_6_LUNA",
  "AI_MODEL_STANDARD",
  "AI_MODEL_HIGH_QUALITY",
  "OPENROUTER_GOOGLE_2_5_flashlite",
  "OPENROUTER_API_BASE",
  "OPENROUTER_API_KEY",
  "OPENROUTER_ART",
  "OPENROUTER_API_KEY_ART",
  "OPENROUTER_API_KEY_ART_BACKUP",
  "BLOTATO_SCRIPT_MODEL",
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
  process.env.OPENROUTER_ART_BACKUP = "bytedance-seed/seedream-4.5";
  process.env.OPENROUTER_META = "meta-llama/llama-4-scout";
  process.env.OPENROUTER_DEEPSEEK_v4_flash = "deepseek/deepseek-v4-flash";
  process.env.OPENROUTER_DEEPSEEK_v4_pro = "deepseek/deepseek-v4-pro";
  process.env.OPENROUTER_ANTHROPIC_4_6 = "anthropic/claude-sonnet-4.6";
  process.env.OPENROUTER_GPT_5_6_LUNA = "openai/gpt-5.6-luna";
  process.env.OPENROUTER_GOOGLE_2_5_flashlite = "google/gemini-2.5-flash-lite";
  process.env.OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
  process.env.OPENROUTER_API_KEY = "sk-or-global-test-value";
  process.env.OPENROUTER_ART = "recraft/recraft-v4.1";
  process.env.BLOTATO_SCRIPT_MODEL = "anthropic/claude-sonnet-4-5";
  delete process.env.OPENROUTER_API_KEY_ART;
  delete process.env.OPENROUTER_API_KEY_ART_BACKUP;
}

test("OpenRouter text routes used by blog, Zernio, RSS and audits resolve spreadsheet env names", async () => {
  const oldEnv = snapshotEnv(OPENROUTER_ENV_NAMES);
  applySpreadsheetOpenRouterEnv();

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?openrouterRoutes=${Date.now()}`);
    const expectedRoutes = {
      // deepseekV4Flash replaces meta in these routes
      blogWeekly: ["OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_GPT_5_6_LUNA", "OPENROUTER_DEEPSEEK_v4_pro"],
      zernioDaily: ["OPENROUTER_GPT_5_6_LUNA", "OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_DEEPSEEK_v4_flash"],
      zernioQuiz: ["OPENROUTER_GPT_5_6_LUNA", "OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_DEEPSEEK_v4_flash"],
      rssRewrite: ["OPENROUTER_GPT_5_6_LUNA", "OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_DEEPSEEK_v4_flash"],
      rssShortTitle: ["OPENROUTER_GPT_5_6_LUNA", "OPENROUTER_GOOGLE_2_5_flashlite"],
      auditForensic: [
        "OPENROUTER_ANTHROPIC_4_6",
        "OPENROUTER_GOOGLE_2_5_flashlite",
        "OPENROUTER_GPT_5_6_LUNA",
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

test("blotatoNewsShort route resolves with highQuality before standard in fallback chain", async () => {
  const oldEnv = snapshotEnv(OPENROUTER_ENV_NAMES);
  applySpreadsheetOpenRouterEnv();

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?blotatoChain=${Date.now()}`);
    const diagnostics = getProviderDiagnosticsForRoute("blotatoNewsShort");
    const configured = diagnostics.configuredProviders.filter((p) => p.configured);

    // blotatoScript (BLOTATO_SCRIPT_MODEL) must be first
    assert.equal(configured[0]?.providerId, "blotatoScript", "blotatoScript should be first in chain");
    assert.equal(configured[0]?.model, "anthropic/claude-sonnet-4-5");

    // highQuality (anthropic46) must appear before the general Luna/standard lane
    const hqIdx = configured.findIndex((p) => p.providerId === "anthropic46" || p.providerId === "highQuality");
    const stdIdx = configured.findIndex((p) => p.providerId === "gpt56Luna" || p.providerId === "standard");
    assert.ok(hqIdx !== -1, "highQuality/anthropic46 should be present in blotatoNewsShort chain");
    assert.ok(hqIdx < stdIdx || stdIdx === -1, "highQuality must appear before standard in blotatoNewsShort chain");
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
    assert.equal(primary?.model, "recraft/recraft-v4.1");

    const backup = diagnostics.find((provider) => provider.providerId === "artworkBackup");
    assert.equal(backup?.configured, true);
    assert.equal(backup?.modelEnv, "OPENROUTER_ART_BACKUP");
    assert.equal(backup?.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(backup?.model, "bytedance-seed/seedream-4.5");
  } finally {
    restoreEnv(oldEnv);
  }
});


test("OpenRouter artwork payload explicitly requests image output modalities", async () => {
  const oldEnv = snapshotEnv([
    "ARTWORK_MODALITIES",
    "OPENROUTER_ARTWORK_MODALITIES",
    "ARTWORK_IMAGE_CONFIG_ENABLED",
    "ARTWORK_IMAGE_ASPECT_RATIO",
    "BLOG_ARTWORK_ASPECT_RATIO",
    "PODCAST_ARTWORK_ASPECT_RATIO",
  ]);

  try {
    delete process.env.ARTWORK_MODALITIES;
    delete process.env.OPENROUTER_ARTWORK_MODALITIES;
    delete process.env.ARTWORK_IMAGE_ASPECT_RATIO;
    delete process.env.BLOG_ARTWORK_ASPECT_RATIO;
    delete process.env.PODCAST_ARTWORK_ASPECT_RATIO;
    delete process.env.ARTWORK_IMAGE_CONFIG_ENABLED;

    const { buildArtworkChatPayload, extractBase64Image } = await import(`../services/artwork/utils/openrouterImagePayload.js?payload=${Date.now()}`);

    const blogPayload = buildArtworkChatPayload({
      model: "recraft/recraft-v4.1",
      instruction: "Create a text-free blog hero.",
      maxTokens: 512,
      mode: "blog",
    });

    assert.deepEqual(blogPayload.modalities, ["image", "text"]);
    assert.equal(blogPayload.stream, false);
    assert.equal(blogPayload.max_tokens, 512);
    assert.equal(blogPayload.image_config, undefined);

    process.env.ARTWORK_IMAGE_CONFIG_ENABLED = "true";
    const podcastPayload = buildArtworkChatPayload({
      model: "bytedance-seed/seedream-4.5",
      instruction: "Create a text-free podcast square.",
      mode: "podcast",
    });

    assert.deepEqual(podcastPayload.modalities, ["image"]);
    assert.equal(podcastPayload.image_config.aspect_ratio, "1:1");

    process.env.ARTWORK_MODALITIES = "image";
    const imageOnlyPayload = buildArtworkChatPayload({
      model: "some/image-only-model",
      instruction: "Create a text-free image.",
      mode: "blog",
    });
    assert.deepEqual(imageOnlyPayload.modalities, ["image"]);

    assert.equal(
      extractBase64Image({ choices: [{ message: { images: [{ image_url: { url: "data:image/png;base64,abc123" } }] } }] }),
      "abc123"
    );
  } finally {
    restoreEnv(oldEnv);
  }
});


test("podcast script routes use Luna for drafting and Claude for synthesis/editorial", async () => {
  const oldEnv = snapshotEnv(OPENROUTER_ENV_NAMES);
  applySpreadsheetOpenRouterEnv();
  process.env.AI_MODEL_STANDARD = "openai/gpt-5.6-luna";
  process.env.AI_MODEL_HIGH_QUALITY = "anthropic/claude-sonnet-4.6";

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?podcastQuality=${Date.now()}`);
    for (const routeName of ["scriptIntro", "scriptMain", "scriptOutro"]) {
      const configured = getProviderDiagnosticsForRoute(routeName).configuredProviders.filter((p) => p.configured);
      assert.equal(configured[0]?.model, "openai/gpt-5.6-luna", `${routeName} should draft with GPT-5.6 Luna`);
    }

    for (const routeName of ["scriptMainSynthesis", "editorialPass"]) {
      const configured = getProviderDiagnosticsForRoute(routeName).configuredProviders.filter((p) => p.configured);
      assert.equal(configured[0]?.model, "anthropic/claude-sonnet-4.6", `${routeName} should lead with Claude Sonnet 4.6`);
    }
  } finally {
    restoreEnv(oldEnv);
  }
});
