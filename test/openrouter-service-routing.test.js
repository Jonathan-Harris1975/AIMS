import test from "node:test";
import assert from "node:assert/strict";

const OPENROUTER_ENV_NAMES = [
  "OPENROUTER_ART_BACKUP",
  "OPENROUTER_META",
  "OPENROUTER_ANTHROPIC_4_6",
  "OPENROUTER_CLAUDE_SONNET_5",
  "OPENROUTER_CLAUDE_OPUS_4_7",
  "OPENROUTER_GPT_5_6_SOL",
  "AI_MODEL_STANDARD",
  "AI_MODEL_HIGH_QUALITY",
  "OPENROUTER_GOOGLE_2_5_flashlite",
  "OPENROUTER_API_BASE",
  "OPENROUTER_API_KEY",
  "OPENROUTER_ART",
  "OPENROUTER_API_KEY_ART",
  "OPENROUTER_API_KEY_ART_BACKUP",
  "BLOTATO_SCRIPT_MODEL",
  "COMMS_HUB_MODEL_FREE_PRIMARY",
  "COMMS_HUB_MODEL_FREE_BACKUP",
  "COMMS_HUB_MODEL_FREE_FALLBACK",
  "COMMS_HUB_MODEL_PAID_PRIMARY",
  "COMMS_HUB_MODEL_PAID_BACKUP",
  "COMMS_HUB_MODEL_PAID_FALLBACK",
  "COMMS_HUB_OPENROUTER_ZDR_ONLY",
  "COMMS_HUB_OPENROUTER_DATA_COLLECTION",
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
  process.env.OPENROUTER_ANTHROPIC_4_6 = "anthropic/claude-sonnet-4.6";
  process.env.OPENROUTER_CLAUDE_SONNET_5 = "anthropic/claude-sonnet-4.6";
  process.env.OPENROUTER_CLAUDE_OPUS_4_7 = "anthropic/claude-opus-4.7";
  process.env.OPENROUTER_GPT_5_6_SOL = "openai/gpt-5.6-sol";
  process.env.OPENROUTER_GOOGLE_2_5_flashlite = "google/gemini-2.5-flash-lite";
  process.env.OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
  process.env.OPENROUTER_API_KEY = "sk-or-global-test-value";
  process.env.OPENROUTER_ART = "recraft/recraft-v4.1";
  process.env.BLOTATO_SCRIPT_MODEL = "anthropic/claude-sonnet-4-5";
  process.env.COMMS_HUB_MODEL_FREE_PRIMARY = "openai/gpt-oss-120b:free";
  process.env.COMMS_HUB_MODEL_FREE_BACKUP = "google/gemma-4-31b-it:free";
  process.env.COMMS_HUB_MODEL_FREE_FALLBACK = "inclusionai/ling-3.0-flash:free";
  process.env.COMMS_HUB_MODEL_PAID_PRIMARY = "anthropic/claude-sonnet-4.6";
  process.env.COMMS_HUB_MODEL_PAID_BACKUP = "openai/gpt-5.6-sol";
  process.env.COMMS_HUB_MODEL_PAID_FALLBACK = "anthropic/claude-opus-4.7";
  process.env.COMMS_HUB_OPENROUTER_ZDR_ONLY = "true";
  process.env.COMMS_HUB_OPENROUTER_DATA_COLLECTION = "deny";
  delete process.env.OPENROUTER_API_KEY_ART;
  delete process.env.OPENROUTER_API_KEY_ART_BACKUP;
}

test("OpenRouter text routes used by blog, Zernio, RSS and audits resolve spreadsheet env names", async () => {
  const oldEnv = snapshotEnv(OPENROUTER_ENV_NAMES);
  applySpreadsheetOpenRouterEnv();

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?openrouterRoutes=${Date.now()}`);
    const expectedRoutes = {
      blogWeekly: ["OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_GPT_5_6_SOL"],
      zernioDaily: ["OPENROUTER_CLAUDE_SONNET_5", "OPENROUTER_ANTHROPIC_4_6", "OPENROUTER_GOOGLE_2_5_flashlite"],
      zernioQuiz: ["OPENROUTER_GPT_5_6_SOL", "OPENROUTER_GOOGLE_2_5_flashlite"],
      rssRewrite: ["OPENROUTER_GPT_5_6_SOL", "OPENROUTER_GOOGLE_2_5_flashlite"],
      rssShortTitle: ["OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_GPT_5_6_SOL"],
      auditForensic: [
        "OPENROUTER_ANTHROPIC_4_6",
        "OPENROUTER_GPT_5_6_SOL",
        "OPENROUTER_GOOGLE_2_5_flashlite",
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

    // highQuality (anthropic46) must appear before the general standard lane
    const hqIdx = configured.findIndex((p) => p.providerId === "anthropic46" || p.providerId === "highQuality");
    const stdIdx = configured.findIndex((p) => p.providerId === "standard");
    assert.ok(hqIdx !== -1, "highQuality/anthropic46 should be present in blotatoNewsShort chain");
    assert.ok(hqIdx < stdIdx || stdIdx === -1, "highQuality must appear before standard in blotatoNewsShort chain");
  } finally {
    restoreEnv(oldEnv);
  }
});

test("Comms Hub routes use three free models by default and paid models only on the complex route", async () => {
  const oldEnv = snapshotEnv(OPENROUTER_ENV_NAMES);
  applySpreadsheetOpenRouterEnv();

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?commsModelPolicy=${Date.now()}`);
    const routine = getProviderDiagnosticsForRoute("commsHubDraftSocial").configuredProviders.filter((p) => p.configured);
    assert.deepEqual(routine.map((p) => p.model), [
      "openai/gpt-oss-120b:free",
      "google/gemma-4-31b-it:free",
      "inclusionai/ling-3.0-flash:free",
    ]);
    assert.ok(routine.every((p) => p.apiKeyEnv === "OPENROUTER_API_KEY"));

    const complex = getProviderDiagnosticsForRoute("commsHubDraftComplex").configuredProviders.filter((p) => p.configured);
    assert.deepEqual(complex.map((p) => p.model), [
      "anthropic/claude-sonnet-4.6",
      "openai/gpt-5.6-sol",
      "anthropic/claude-opus-4.7",
    ]);
  } finally {
    restoreEnv(oldEnv);
  }
});

test("Comms Hub OpenRouter requests enforce ZDR and deny data collection", async () => {
  const oldEnv = snapshotEnv(OPENROUTER_ENV_NAMES);
  const oldFetch = globalThis.fetch;
  applySpreadsheetOpenRouterEnv();
  const payloads = [];

  globalThis.fetch = async (_url, options = {}) => {
    payloads.push(JSON.parse(options.body));
    return {
      ok: true,
      json: async () => ({
        model: "openai/gpt-oss-120b:free",
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        usage: {},
      }),
    };
  };

  try {
    const { resilientRequest } = await import(`../services/shared/utils/ai-service.js?commsPrivacy=${Date.now()}`);
    await resilientRequest("commsHubTriage", {
      sessionId: "comms-privacy-test",
      messages: [{ role: "user", content: "Return JSON" }],
      response_format: { type: "json_object" },
      maxRetries: 0,
      timeoutMs: 1000,
    });
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].provider?.zdr, true);
    assert.equal(payloads[0].provider?.data_collection, "deny");
  } finally {
    restoreEnv(oldEnv);
    globalThis.fetch = oldFetch;
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
    assert.equal(blogPayload.max_completion_tokens, undefined);
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


test("podcast script routes use Claude for drafting and premium independent synthesis/editorial fallbacks", async () => {
  const oldEnv = snapshotEnv(OPENROUTER_ENV_NAMES);
  applySpreadsheetOpenRouterEnv();
  process.env.AI_MODEL_STANDARD = "anthropic/claude-sonnet-4.6";
  process.env.AI_MODEL_HIGH_QUALITY = "anthropic/claude-sonnet-4.6";

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?podcastQuality=${Date.now()}`);
    for (const routeName of ["scriptIntro", "scriptMain", "scriptOutro"]) {
      const configured = getProviderDiagnosticsForRoute(routeName).configuredProviders.filter((p) => p.configured);
      assert.equal(configured[0]?.model, "anthropic/claude-sonnet-4.6", `${routeName} should draft with Claude Sonnet 4.6`);
    }

    const synthesis = getProviderDiagnosticsForRoute("scriptMainSynthesis").configuredProviders.filter((p) => p.configured);
    assert.equal(synthesis[0]?.model, "anthropic/claude-sonnet-4.6", "synthesis should lead with Claude Sonnet 4.6");
    assert.equal(synthesis[1]?.model, "openai/gpt-5.6-sol", "synthesis should use GPT-5.6 Sol as the independent premium backup");

    const editorial = getProviderDiagnosticsForRoute("editorialPass").configuredProviders.filter((p) => p.configured);
    assert.equal(editorial[0]?.model, "anthropic/claude-opus-4.7", "editorial/repair should lead with Claude Opus 4.7");
    assert.equal(editorial[1]?.model, "openai/gpt-5.6-sol", "editorial/repair should use GPT-5.6 Sol as the independent premium backup");
  } finally {
    restoreEnv(oldEnv);
  }
});


test("retired GPT-5.6 Luna model cannot be selected through stale generic model env", async () => {
  const oldEnv = snapshotEnv([...OPENROUTER_ENV_NAMES, "AI_MODEL_STANDARD"]);
  applySpreadsheetOpenRouterEnv();
  process.env.AI_MODEL_STANDARD = "openai/gpt-5.6-luna";

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?retiredLuna=${Date.now()}`);
    const diagnostics = getProviderDiagnosticsForRoute("blogWeekly");
    const configured = diagnostics.configuredProviders.filter((p) => p.configured);
    assert.equal(configured.some((p) => p.model === "openai/gpt-5.6-luna"), false);
  } finally {
    restoreEnv(oldEnv);
  }
});


test("retired DeepSeek model cannot be selected through stale generic fallback env", async () => {
  const oldEnv = snapshotEnv([...OPENROUTER_ENV_NAMES, "AI_MODEL_FALLBACK"]);
  applySpreadsheetOpenRouterEnv();
  process.env.AI_MODEL_FALLBACK = "deepseek/deepseek-v4-pro";

  try {
    const { getProviderDiagnosticsForRoute } = await import(`../services/shared/utils/ai-service.js?retiredDeepseek=${Date.now()}`);
    const diagnostics = getProviderDiagnosticsForRoute("blogWeekly");
    const configured = diagnostics.configuredProviders.filter((p) => p.configured);
    assert.equal(configured.some((p) => String(p.model || "").startsWith("deepseek/")), false);
  } finally {
    restoreEnv(oldEnv);
  }
});
