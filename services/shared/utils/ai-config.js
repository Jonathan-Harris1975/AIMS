function looksLikeTemplatePlaceholder(value) {
  return /^\s*\{\{\s*secret\.[^}]+\}\}\s*$/i.test(String(value || ""));
}

function envValue(...names) {
  for (const name of names.flat().filter(Boolean)) {
    const value = process.env[name];
    if (value === undefined || value === null) continue;
    const trimmed = String(value).trim();
    if (!trimmed || looksLikeTemplatePlaceholder(trimmed)) continue;
    return trimmed;
  }
  return undefined;
}

function provider(providerId, modelEnvNames, keyEnvNames) {
  return {
    providerId,
    modelEnvNames,
    keyEnvNames,
    get name() {
      return envValue(...modelEnvNames);
    },
    get apiKey() {
      return envValue(...keyEnvNames);
    },
  };
}

const SHARED_OPENROUTER_KEY = ["OPENROUTER_API_KEY"];
const ART_OPENROUTER_KEY_FALLBACKS = ["OPENROUTER_API_KEY_ART_BACKUP", "OPENROUTER_API_KEY_ART"];

const fast = provider("fast", ["AI_MODEL_FAST"], SHARED_OPENROUTER_KEY);
const standard = provider("standard", ["AI_MODEL_STANDARD"], SHARED_OPENROUTER_KEY);
const highQuality = provider("highQuality", ["AI_MODEL_HIGH_QUALITY"], SHARED_OPENROUTER_KEY);
const fallback = provider("fallback", ["AI_MODEL_FALLBACK"], SHARED_OPENROUTER_KEY);
const json = provider("json", ["AI_MODEL_JSON"], SHARED_OPENROUTER_KEY);
const summary = provider("summary", ["AI_MODEL_SUMMARY"], SHARED_OPENROUTER_KEY);
const audit = provider("audit", ["AI_MODEL_AUDIT"], SHARED_OPENROUTER_KEY);
const image = provider("image", ["AI_MODEL_IMAGE"], SHARED_OPENROUTER_KEY);

const anthropic46 = provider(
  "anthropic46",
  ["OPENROUTER_ANTHROPIC_4_6", "OPENROUTER_ANTHROPIC_4-6", "OPENROUTER_ANTHROPIC_4.6", "OPENROUTER_ANTHROPIC_46", "OPENROUTER_ANTHROPIC"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_ANTHROPIC_4_6", "OPENROUTER_API_KEY_ANTHROPIC_4-6", "OPENROUTER_API_KEY_ANTHROPIC_4.6", "OPENROUTER_API_KEY_ANTHROPIC_46", "OPENROUTER_API_KEY_ANTHROPIC"]
);

const google25FlashLite = provider(
  "google25FlashLite",
  ["OPENROUTER_GOOGLE_2_5_flashlite", "OPENROUTER_GOOGLE_2-5_flashlite", "OPENROUTER_GOOGLE_2.5_flashlite", "OPENROUTER_GOOGLE_25_FLASHLITE", "OPENROUTER_GOOGLE"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_GOOGLE_2_5_flashlite", "OPENROUTER_API_KEY_GOOGLE_2-5_flashlite", "OPENROUTER_API_KEY_GOOGLE_2.5_flashlite", "OPENROUTER_API_KEY_GOOGLE_25_FLASHLITE", "OPENROUTER_API_KEY_GOOGLE"]
);

const chatgptMini5 = provider(
  "chatgptMini5",
  ["OPENROUTER_CHATGPT_mini5_", "OPENROUTER_CHATGPT_mini-5", "OPENROUTER_CHATGPT_mini5", "OPENROUTER_CHATGPT_MINI5", "OPENROUTER_CHATGPT"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_CHATGPT_mini5", "OPENROUTER_API_KEY_CHATGPT_mini-5", "OPENROUTER_API_KEY_CHATGPT_MINI5", "OPENROUTER_API_KEY_CHATGPT"]
);

const blotatoScript = provider(
  "blotatoScript",
  ["BLOTATO_SCRIPT_MODEL", "BLOTATO_NEWS_SCRIPT_MODEL", "OPENROUTER_BLOTATO_SCRIPT_MODEL"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_BLOTATO_SCRIPT"]
);

const deepseekV4Pro = provider(
  "deepseekV4Pro",
  ["OPENROUTER_DEEPSEEK_v4_pro", "OPENROUTER_DEEPSEEK_V4_PRO", "OPENROUTER_DEEPSEEK"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_DEEPSEEK_v4_pro", "OPENROUTER_API_KEY_DEEPSEEK_V4_PRO", "OPENROUTER_API_KEY_DEEPSEEK"]
);

const deepseekV4Flash = provider(
  "deepseekV4Flash",
  ["OPENROUTER_DEEPSEEK_v4_flash", "OPENROUTER_DEEPSEEK_V4_FLASH"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_DEEPSEEK_v4_flash", "OPENROUTER_API_KEY_DEEPSEEK_V4_FLASH"]
);

const meta = provider("meta", ["OPENROUTER_META"], [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_META"]);
const art = provider("art", ["OPENROUTER_ART", "OPENROUTER_ART_BACKUP"], [...SHARED_OPENROUTER_KEY, ...ART_OPENROUTER_KEY_FALLBACKS]);
const artworkPrimary = provider("artworkPrimary", ["OPENROUTER_ART"], [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_ART"]);
const artworkBackup = provider("artworkBackup", ["OPENROUTER_ART_BACKUP"], [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_ART_BACKUP", "OPENROUTER_API_KEY_ART"]);

const modelRegistry = {
  fast,
  standard,
  highQuality,
  fallback,
  json,
  summary,
  audit,
  image,
  google: google25FlashLite,
  chatgpt: chatgptMini5,
  blotatoScript,
  deepseek: deepseekV4Pro,
  anthropic: anthropic46,
  meta,
  art,
  artworkPrimary,
  artworkBackup,
  anthropic46,
  google25FlashLite,
  chatgptMini5,
  deepseekV4Pro,
  deepseekV4Flash,
};

function providerIsConfigured(providerId) {
  const conf = modelRegistry[providerId];
  return Boolean(conf?.name && conf?.apiKey);
}

function routeChain(preferredProviderIds, fallbackProviderIds) {
  const ids = [
    ...preferredProviderIds.filter(providerIsConfigured),
    ...fallbackProviderIds,
  ];

  return ids.filter((id, index) => ids.indexOf(id) === index);
}

export const aiConfig = {
  models: modelRegistry,

  routeModels: {
    intro: routeChain(["fast", "standard", "fallback"], ["chatgpt", "google", "meta"]),
    main: routeChain(["standard", "fast", "fallback"], ["google", "chatgpt", "deepseek"]),
    outro: routeChain(["fast", "standard", "fallback"], ["google", "chatgpt", "meta"]),
    scriptIntro: routeChain(["fast", "standard", "fallback"], ["chatgpt", "google", "meta"]),
    scriptMain: routeChain(["standard", "fast", "fallback"], ["google", "chatgpt", "deepseek"]),
    scriptOutro: routeChain(["fast", "standard", "fallback"], ["google", "chatgpt", "meta"]),
    compose: routeChain(["highQuality", "standard", "fallback"], ["deepseek", "anthropic", "google"]),
    editorialPass: routeChain(["standard", "highQuality", "fallback"], ["chatgpt"]),
    editAndFormat: routeChain(["standard", "fast", "fallback"], ["chatgpt", "google", "deepseek"]),
    metadata: routeChain(["summary", "json", "fast", "fallback"], ["google", "chatgpt", "deepseek"]),
    podcastHelper: routeChain(["summary", "fast", "fallback"], ["chatgpt", "google", "meta"]),
    seoKeywords: routeChain(["summary", "fast", "fallback"], ["chatgpt", "google"]),
    artworkPrompt: routeChain(["summary", "fast", "fallback"], ["meta", "google"]),
    artworkImage: routeChain(["image"], ["artworkPrimary", "artworkBackup"]),
    rssRewrite: routeChain(["standard", "fast", "fallback"], ["chatgpt", "google", "meta"]),
    rssShortTitle: routeChain(["fast", "summary", "fallback"], ["chatgpt", "google", "meta"]),
    blogWeekly: routeChain(["standard", "summary", "fallback"], ["google", "chatgpt", "deepseek"]),
    blogSocial: routeChain(["summary", "fast", "standard", "fallback"], ["google", "chatgpt", "deepseek"]),
    onBrandAudit: routeChain(["audit", "highQuality", "standard", "fallback"], ["anthropic46", "google25FlashLite", "chatgptMini5", "deepseekV4Pro", "deepseekV4Flash", "meta", "anthropic", "google", "chatgpt", "deepseek"]),
    auditForensic: routeChain(["audit", "highQuality", "standard", "fallback"], ["anthropic46", "google25FlashLite", "chatgptMini5", "deepseekV4Pro", "deepseekV4Flash", "meta", "anthropic", "google", "chatgpt", "deepseek"]),
    oneupDaily: routeChain(["fast", "standard", "fallback"], ["chatgpt", "google", "deepseek"]),
    oneupQuiz: routeChain(["fast", "standard", "fallback"], ["chatgpt", "google", "deepseek"]),
    oneupEbook: routeChain(["fast", "standard", "fallback"], ["chatgpt", "google", "deepseek"]),
    // Blotato script quality is production-critical. Do not fall back to the ultra-cheap fast lane by default;
    // weak scripts cost more downstream when Blotato grades or publishes a poor video.
    blotatoNewsShort: routeChain(["blotatoScript", "standard", "highQuality", "summary"], ["chatgptMini5", "anthropic46", "deepseekV4Pro"]),
  },

  commonParams: { temperature: 0.65, top_p: 0.9, timeout: 90000 },

  headers: {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || process.env.APP_URL || "http://localhost:3000",
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || process.env.APP_TITLE || "AI Management Suite",
  },
};

export default aiConfig;
