function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return undefined;
}

export const OPENROUTER_SPREADSHEET_ENV_KEYS = Object.freeze({
  apiBase: "OPENROUTER_API_BASE",
  apiKey: "OPENROUTER_API_KEY",
  artworkPrimary: "OPENROUTER_ART",
  artworkBackup: "OPENROUTER_ART_BACKUP",
  anthropic46: "OPENROUTER_ANTHROPIC_4_6",
  google25FlashLite: "OPENROUTER_GOOGLE_2_5_flashlite",
  chatgptMini5: "OPENROUTER_CHATGPT_mini5_",
  deepseekV4Pro: "OPENROUTER_DEEPSEEK_v4_pro",
  deepseekV4Flash: "OPENROUTER_DEEPSEEK_v4_flash",
  meta: "OPENROUTER_META",
});

const GLOBAL_OPENROUTER_KEY_NAMES = [OPENROUTER_SPREADSHEET_ENV_KEYS.apiKey];

function provider(modelEnvNames, keyEnvNames) {
  return {
    name: envValue(...modelEnvNames),
    apiKey: envValue(...keyEnvNames),
    modelEnvNames,
    keyEnvNames,
  };
}

const artworkPrimary = provider(
  [OPENROUTER_SPREADSHEET_ENV_KEYS.artworkPrimary],
  ["OPENROUTER_API_KEY_ART", ...GLOBAL_OPENROUTER_KEY_NAMES]
);

const artworkBackup = provider(
  [OPENROUTER_SPREADSHEET_ENV_KEYS.artworkBackup],
  ["OPENROUTER_API_KEY_ART_BACKUP", "OPENROUTER_API_KEY_ART", ...GLOBAL_OPENROUTER_KEY_NAMES]
);

const anthropic46 = provider(
  [OPENROUTER_SPREADSHEET_ENV_KEYS.anthropic46, "OPENROUTER_ANTHROPIC_46", "OPENROUTER_ANTHROPIC"],
  ["OPENROUTER_API_KEY_ANTHROPIC_4_6", "OPENROUTER_API_KEY_ANTHROPIC_46", "OPENROUTER_API_KEY_ANTHROPIC", ...GLOBAL_OPENROUTER_KEY_NAMES]
);

const google25FlashLite = provider(
  [OPENROUTER_SPREADSHEET_ENV_KEYS.google25FlashLite, "OPENROUTER_GOOGLE_25_FLASHLITE", "OPENROUTER_GOOGLE"],
  ["OPENROUTER_API_KEY_GOOGLE_2_5_flashlite", "OPENROUTER_API_KEY_GOOGLE_25_FLASHLITE", "OPENROUTER_API_KEY_GOOGLE", ...GLOBAL_OPENROUTER_KEY_NAMES]
);

const chatgptMini5 = provider(
  [OPENROUTER_SPREADSHEET_ENV_KEYS.chatgptMini5, "OPENROUTER_CHATGPT_mini5", "OPENROUTER_CHATGPT_MINI5", "OPENROUTER_CHATGPT"],
  ["OPENROUTER_API_KEY_CHATGPT_mini5", "OPENROUTER_API_KEY_CHATGPT_MINI5", "OPENROUTER_API_KEY_CHATGPT", ...GLOBAL_OPENROUTER_KEY_NAMES]
);

const deepseekV4Pro = provider(
  [OPENROUTER_SPREADSHEET_ENV_KEYS.deepseekV4Pro, "OPENROUTER_DEEPSEEK_V4_PRO", "OPENROUTER_DEEPSEEK"],
  ["OPENROUTER_API_KEY_DEEPSEEK_v4_pro", "OPENROUTER_API_KEY_DEEPSEEK_V4_PRO", "OPENROUTER_API_KEY_DEEPSEEK", ...GLOBAL_OPENROUTER_KEY_NAMES]
);

const deepseekV4Flash = provider(
  [OPENROUTER_SPREADSHEET_ENV_KEYS.deepseekV4Flash, "OPENROUTER_DEEPSEEK_V4_FLASH"],
  ["OPENROUTER_API_KEY_DEEPSEEK_v4_flash", "OPENROUTER_API_KEY_DEEPSEEK_V4_FLASH", ...GLOBAL_OPENROUTER_KEY_NAMES]
);

const meta = provider(
  [OPENROUTER_SPREADSHEET_ENV_KEYS.meta],
  ["OPENROUTER_API_KEY_META", ...GLOBAL_OPENROUTER_KEY_NAMES]
);

export const aiConfig = {
  models: {
    artwork: artworkPrimary,
    artworkPrimary,
    artworkBackup,
    google: google25FlashLite,
    chatgpt: chatgptMini5,
    deepseek: deepseekV4Pro,
    anthropic: anthropic46,
    meta,
    anthropic46,
    google25FlashLite,
    chatgptMini5,
    deepseekV4Pro,
    deepseekV4Flash,
  },

  routeModels: {
    artworkImage: ["artworkPrimary", "artworkBackup"],
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
    rssRewrite: ["chatgpt", "google", "meta"],
    rssShortTitle: ["chatgpt", "google", "meta"],
    blogWeekly: ["google", "chatgpt", "deepseek"],
    auditForensic: [
      "anthropic46",
      "google25FlashLite",
      "chatgptMini5",
      "deepseekV4Pro",
      "deepseekV4Flash",
      "meta",
      "anthropic",
      "google",
      "chatgpt",
      "deepseek",
    ],
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
