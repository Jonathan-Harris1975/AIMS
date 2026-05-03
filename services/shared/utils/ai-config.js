const firstConfiguredEnv = (envNames = []) => {
  for (const envName of envNames) {
    const value = process.env[envName];
    if (value !== undefined && String(value).trim() !== "") {
      return { envName, value: String(value).trim() };
    }
  }
  return { envName: envNames[0], value: undefined };
};

const model = (
  providerId,
  modelEnv,
  apiKeyEnv,
  { modelEnvAliases = [], apiKeyEnvAliases = [] } = {}
) => {
  const modelEnvCandidates = [...modelEnvAliases, modelEnv];
  const apiKeyEnvCandidates = [...apiKeyEnvAliases, apiKeyEnv];
  const resolvedModel = firstConfiguredEnv(modelEnvCandidates);
  const resolvedApiKey = firstConfiguredEnv(apiKeyEnvCandidates);

  return {
    providerId,
    modelEnv,
    apiKeyEnv,
    modelEnvCandidates,
    apiKeyEnvCandidates,
    resolvedModelEnv: resolvedModel.envName,
    resolvedApiKeyEnv: resolvedApiKey.envName,
    name: resolvedModel.value,
    apiKey: resolvedApiKey.value,
  };
};

export const aiConfig = {
  models: {
    google: model("google", "OPENROUTER_GOOGLE", "OPENROUTER_API_KEY_GOOGLE", {
      modelEnvAliases: ["OPENROUTER_GOOGLE_2-5_flashlite"],
      apiKeyEnvAliases: ["OPENROUTER_API_KEY_GOOGLE_2-5_flashlite"],
    }),
    chatgpt: model("chatgpt", "OPENROUTER_CHATGPT", "OPENROUTER_API_KEY_CHATGPT", {
      modelEnvAliases: ["OPENROUTER_CHATGPT_mini-5"],
      apiKeyEnvAliases: ["OPENROUTER_API_KEY_CHATGPT_mini5"],
    }),
    deepseek: model("deepseek", "OPENROUTER_DEEPSEEK", "OPENROUTER_API_KEY_DEEPSEEK", {
      modelEnvAliases: ["OPENROUTER_DEEPSEEK_v4_pro"],
      apiKeyEnvAliases: ["OPENROUTER_API_KEY_DEEPSEEK_v4_pro"],
    }),
    deepseekFlash: model("deepseekFlash", "OPENROUTER_DEEPSEEK_FLASH", "OPENROUTER_API_KEY_DEEPSEEK_FLASH", {
      modelEnvAliases: ["OPENROUTER_DEEPSEEK_v4_flash"],
      apiKeyEnvAliases: ["OPENROUTER_API_KEY_DEEPSEEK_v4_flash"],
    }),
    anthropic: model("anthropic", "OPENROUTER_ANTHROPIC", "OPENROUTER_API_KEY_ANTHROPIC", {
      modelEnvAliases: ["OPENROUTER_ANTHROPIC_4-6"],
      apiKeyEnvAliases: ["OPENROUTER_API_KEY_ANTHROPIC_4-6"],
    }),
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
