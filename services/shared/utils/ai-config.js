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

const gpt56Luna = provider(
  "gpt56Luna",
  ["OPENROUTER_GPT_5_6_LUNA", "OPENROUTER_GPT56_LUNA"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_GPT_5_6_LUNA", "OPENROUTER_API_KEY_GPT56_LUNA"]
);

const claudeSonnet5 = provider(
  "claudeSonnet5",
  ["OPENROUTER_CLAUDE_SONNET_5", "OPENROUTER_ANTHROPIC_SONNET_5", "AI_MODEL_HIGH_QUALITY"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_CLAUDE_SONNET_5", "OPENROUTER_API_KEY_ANTHROPIC_SONNET_5"]
);

const claudeOpus47 = provider(
  "claudeOpus47",
  ["OPENROUTER_CLAUDE_OPUS_4_7", "OPENROUTER_ANTHROPIC_OPUS_4_7"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_CLAUDE_OPUS_4_7", "OPENROUTER_API_KEY_ANTHROPIC_OPUS_4_7"]
);

const gpt56Sol = provider(
  "gpt56Sol",
  ["OPENROUTER_GPT_5_6_SOL", "OPENROUTER_GPT56_SOL"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_GPT_5_6_SOL", "OPENROUTER_API_KEY_GPT56_SOL"]
);

const blotatoScript = provider(
  "blotatoScript",
  ["BLOTATO_SCRIPT_MODEL", "BLOTATO_NEWS_SCRIPT_MODEL", "OPENROUTER_BLOTATO_SCRIPT_MODEL"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_BLOTATO_SCRIPT"]
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
  chatgpt: gpt56Luna,
  blotatoScript,
  anthropic: anthropic46,
  meta,
  art,
  artworkPrimary,
  artworkBackup,
  anthropic46,
  google25FlashLite,
  gpt56Luna,
  claudeSonnet5,
  claudeOpus47,
  gpt56Sol,
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
    intro: routeChain(["fast", "standard", "fallback"], ["gpt56Luna", "google25FlashLite", "meta"]),
    main: routeChain(["standard", "fast", "fallback"], ["google25FlashLite", "gpt56Luna", "gpt56Sol"]),
    outro: routeChain(["fast", "standard", "fallback"], ["google25FlashLite", "gpt56Luna", "meta"]),
    scriptIntro: routeChain(["gpt56Luna", "standard", "fallback"], ["google25FlashLite", "meta"]),
    scriptMain: routeChain(["gpt56Luna", "standard", "fallback"], ["google25FlashLite", "gpt56Sol"]),
    scriptMainSynthesis: routeChain(["claudeSonnet5", "gpt56Sol"], ["claudeOpus47"]),
    scriptOutro: routeChain(["gpt56Luna", "standard", "fallback"], ["google25FlashLite", "meta"]),
    compose: routeChain(["highQuality", "standard", "fallback"], ["anthropic46", "gpt56Sol", "google25FlashLite"]),
    editorialPass: routeChain(["claudeOpus47", "gpt56Sol"], ["claudeSonnet5"]),
    editAndFormat: routeChain(["standard", "fast", "fallback"], ["gpt56Luna", "google25FlashLite", "gpt56Sol"]),
    metadata: routeChain(["summary", "json", "fast", "fallback"], ["google25FlashLite", "gpt56Luna", "gpt56Sol"]),
    podcastHelper: routeChain(["summary", "fast", "fallback"], ["gpt56Luna", "google25FlashLite", "meta"]),
    seoKeywords: routeChain(["summary", "fast", "fallback"], ["gpt56Luna", "google25FlashLite"]),
    artworkPrompt: routeChain(["summary", "fast", "fallback"], ["meta", "google25FlashLite"]),
    artworkImage: routeChain(["image"], ["artworkPrimary", "artworkBackup"]),
    rssRewrite: routeChain(["standard", "fast", "fallback"], ["gpt56Luna", "google25FlashLite", "gpt56Sol"]),
    rssShortTitle: routeChain(["fast", "summary", "fallback"], ["gpt56Luna", "google25FlashLite"]),
    blogWeekly: routeChain(["standard", "summary", "fallback"], ["google25FlashLite", "gpt56Luna", "gpt56Sol"]),
    blogSocial: routeChain(["summary", "fast", "standard", "fallback"], ["google25FlashLite", "gpt56Luna", "gpt56Sol"]),
    onBrandAudit: routeChain(["audit", "highQuality", "standard", "fallback"], ["anthropic46", "gpt56Sol", "google25FlashLite", "gpt56Luna", "meta"]),
    auditForensic: routeChain(["audit", "highQuality", "standard", "fallback"], ["anthropic46", "gpt56Sol", "google25FlashLite", "gpt56Luna", "meta"]),
    zernioDaily: routeChain(["fast", "standard", "fallback"], ["gpt56Luna", "google25FlashLite", "gpt56Sol"]),
    zernioQuiz: routeChain(["fast", "standard", "fallback"], ["gpt56Luna", "google25FlashLite", "gpt56Sol"]),
    zernioEbook: routeChain(["fast", "standard", "fallback"], ["gpt56Luna", "google25FlashLite", "gpt56Sol"]),
    zernioPodcastPromo: routeChain(["highQuality", "standard", "fallback"], ["gpt56Sol", "google25FlashLite"]),
    // Blotato script quality is production-critical. highQuality sits above standard so Claude 4.6
    // is the first fallback after the dedicated blotatoScript provider, ahead of the general Luna lane.
    blotatoNewsShort: routeChain(["blotatoScript", "highQuality", "standard", "fallback"], ["anthropic46", "gpt56Sol", "gpt56Luna"]),
    // Newsletter engine (services/newsletter). Composition needs the same
    // editorial quality bar as the blog; QA review is intentionally routed
    // through a different provider than composition so the reviewer isn't
    // just re-approving its own output.
    newsletterCompose: routeChain(["standard", "highQuality", "fallback"], ["google25FlashLite", "gpt56Luna", "gpt56Sol"]),
    newsletterSubject: routeChain(["fast", "summary", "fallback"], ["gpt56Luna", "google25FlashLite"]),
    newsletterQaReview: routeChain(["highQuality", "audit", "standard", "fallback"], ["anthropic46", "gpt56Sol", "gpt56Luna"]),
    newsletterHeroPrompt: routeChain(["summary", "fast", "fallback"], ["meta", "google25FlashLite"]),
  },

  commonParams: { temperature: 0.65, top_p: 0.9, timeout: 90000 },

  headers: {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || process.env.APP_URL || "http://localhost:3000",
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || process.env.APP_TITLE || "AI Management Suite",
  },
};

export default aiConfig;
