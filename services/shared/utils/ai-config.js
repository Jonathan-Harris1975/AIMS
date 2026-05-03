const model = (providerId, modelEnv, apiKeyEnv) => ({
  providerId,
  modelEnv,
  apiKeyEnv,
  name: process.env[modelEnv],
  apiKey: process.env[apiKeyEnv],
});

export const aiConfig = {
  models: {
    google: model("google", "OPENROUTER_GOOGLE", "OPENROUTER_API_KEY_GOOGLE"),
    chatgpt: model("chatgpt", "OPENROUTER_CHATGPT", "OPENROUTER_API_KEY_CHATGPT"),
    deepseek: model("deepseek", "OPENROUTER_DEEPSEEK", "OPENROUTER_API_KEY_DEEPSEEK"),
    anthropic: model("anthropic", "OPENROUTER_ANTHROPIC", "OPENROUTER_API_KEY_ANTHROPIC"),
    meta: model("meta", "OPENROUTER_META", "OPENROUTER_API_KEY_META"),
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
    rssRewrite: ["chatgpt", "google", "meta"],
    rssShortTitle: ["chatgpt", "google", "meta"],
    blogWeekly: ["google", "chatgpt", "deepseek"],
    auditForensic: ["anthropic", "google", "chatgpt", "deepseek"],
    oneupDaily: ["chatgpt", "google", "deepseek"],
    oneupQuiz: ["chatgpt", "google", "deepseek"],
  },

  commonParams: { temperature: 0.85, timeout: 45000 },

  headers: {
    "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
    "X-Title": process.env.APP_TITLE || "Podcast Script Generation",
  },
};

export default aiConfig;
