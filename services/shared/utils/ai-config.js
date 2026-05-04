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

export const aiConfig = {
  models: {
    google: google25FlashLite,
    chatgpt: chatgptMini5,
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
  },

  routeModels: {
    intro: ["chatgpt", "google", "meta"],
    main: ["google", "chatgpt", "deepseek"],
    outro: ["google", "chatgpt", "meta"],
    scriptIntro: ["chatgpt", "google", "meta"],
    scriptMain: ["google", "chatgpt", "deepseek"],
    scriptOutro: ["google", "chatgpt", "meta"],
    compose: ["deepseek", "anthropic", "google"],
    editorialPass: ["chatgpt"],
    editAndFormat: ["chatgpt", "google", "deepseek"],
    metadata: ["google", "chatgpt", "deepseek"],
    podcastHelper: ["chatgpt", "google", "meta"],
    seoKeywords: ["chatgpt", "google"],
    artworkPrompt: ["meta", "google"],
    artworkImage: ["artworkPrimary", "artworkBackup"],
    rssRewrite: ["chatgpt", "google", "meta"],
    rssShortTitle: ["chatgpt", "google", "meta"],
    blogWeekly: ["google", "chatgpt", "deepseek"],
    auditForensic: ["anthropic46", "google25FlashLite", "chatgptMini5", "deepseekV4Pro", "deepseekV4Flash", "meta", "anthropic", "google", "chatgpt", "deepseek"],
    oneupDaily: ["chatgpt", "google", "deepseek"],
    oneupQuiz: ["chatgpt", "google", "deepseek"],
  },

  commonParams: { temperature: 0.85, timeout: 45000 },

  headers: {
    "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
    "X-Title": process.env.APP_TITLE || "AI Management Suite",
  },
};

export default aiConfig;
