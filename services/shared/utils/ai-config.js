const model = (providerId, modelEnv, apiKeyEnv) => ({
  providerId,
  modelEnv,
  apiKeyEnv,
  name: process.env[modelEnv],
  apiKey: process.env[apiKeyEnv],
});

export const aiConfig = {
  models: {
    google:        model("google",        "OPENROUTER_GOOGLE_2-5_flashlite",  "OPENROUTER_API_KEY_GOOGLE_2-5_flashlite"),
    chatgpt:       model("chatgpt",       "OPENROUTER_CHATGPT_mini-5",        "OPENROUTER_API_KEY_CHATGPT_mini5"),
    deepseek:      model("deepseek",      "OPENROUTER_DEEPSEEK_v4_pro",       "OPENROUTER_API_KEY_DEEPSEEK_v4_pro"),
    deepseek_flash: model("deepseek",     "OPENROUTER_DEEPSEEK_v4_flash",     "OPENROUTER_API_KEY_DEEPSEEK_v4_flash"),
    anthropic:     model("anthropic",     "OPENROUTER_ANTHROPIC_4-6",         "OPENROUTER_API_KEY_ANTHROPIC_4-6"),
    meta:          model("meta",          "OPENROUTER_META",                  "OPENROUTER_API_KEY_META"),
  },

  routeModels: {
    intro:          ["chatgpt", "google", "meta"],
    main:           ["google", "chatgpt", "deepseek"],
    outro:          ["google", "chatgpt", "meta"],
    scriptIntro:    ["chatgpt", "google", "meta"],
    scriptMain:     ["google", "chatgpt", "deepseek"],
    scriptOutro:    ["google", "chatgpt", "meta"],
    compose:        ["deepseek", "anthropic", "google"],
    editorialPass:  ["chatgpt"],
    editAndFormat:  ["chatgpt", "google", "deepseek"],
    metadata:       ["google", "chatgpt", "deepseek"],
    podcastHelper:  ["chatgpt", "google", "meta"],
    seoKeywords:    ["chatgpt", "google"],
    artworkPrompt:  ["meta", "google"],
    rssRewrite:     ["chatgpt", "google", "meta"],
    rssShortTitle:  ["chatgpt", "google", "meta"],
    blogWeekly:     ["google", "chatgpt", "deepseek_flash"],
    auditForensic:  ["anthropic", "google", "chatgpt", "deepseek"],
    oneupDaily:     ["chatgpt", "google", "deepseek_flash"],
    oneupQuiz:      ["chatgpt", "google", "deepseek_flash"],
  },

  commonParams: { temperature: 0.85, timeout: 45000 },

  headers: {
    "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
    "X-Title": process.env.APP_TITLE || "Podcast Script Generation",
  },
};

export default aiConfig;
