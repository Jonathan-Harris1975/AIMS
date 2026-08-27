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
const COMMON_FREE_MODEL_ENVS = ["OPENROUTER_FREE_PRIMARY_MODEL"];
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


const commsFreePrimary = provider(
  "commsFreePrimary",
  ["COMMS_HUB_MODEL_FREE_PRIMARY", ...COMMON_FREE_MODEL_ENVS],
  SHARED_OPENROUTER_KEY
);

const commsFreeBackup = provider(
  "commsFreeBackup",
  ["COMMS_HUB_MODEL_FREE_BACKUP"],
  SHARED_OPENROUTER_KEY
);

const commsFreeFallback = provider(
  "commsFreeFallback",
  ["COMMS_HUB_MODEL_FREE_FALLBACK"],
  SHARED_OPENROUTER_KEY
);

const commsPaidEconomy = provider(
  "commsPaidEconomy",
  ["COMMS_HUB_MODEL_PAID_ECONOMY"],
  SHARED_OPENROUTER_KEY
);

const commsPaidPrimary = provider(
  "commsPaidPrimary",
  ["COMMS_HUB_MODEL_PAID_PRIMARY"],
  SHARED_OPENROUTER_KEY
);

const commsPaidBackup = provider(
  "commsPaidBackup",
  ["COMMS_HUB_MODEL_PAID_BACKUP"],
  SHARED_OPENROUTER_KEY
);

const commsPaidFallback = provider(
  "commsPaidFallback",
  ["COMMS_HUB_MODEL_PAID_FALLBACK"],
  SHARED_OPENROUTER_KEY
);

const outreachWriter = provider(
  "outreachWriter",
  ["OUTREACH_ARTICLE_MODEL", "OUTREACH_PITCH_MODEL", "OUTREACH_REPLY_MODEL"],
  SHARED_OPENROUTER_KEY
);

const outreachReviewer = provider(
  "outreachReviewer",
  ["OUTREACH_ARTICLE_REVIEW_MODEL"],
  SHARED_OPENROUTER_KEY
);

const outreachFallback = provider(
  "outreachFallback",
  ["OUTREACH_ARTICLE_FALLBACK_MODEL"],
  SHARED_OPENROUTER_KEY
);

const newsletterEditorial = provider(
  "newsletterEditorial",
  ["NEWSLETTER_MODEL_EDITORIAL"],
  SHARED_OPENROUTER_KEY
);

const blotatoScript = provider(
  "blotatoScript",
  ["BLOTATO_SCRIPT_MODEL", "BLOTATO_NEWS_SCRIPT_MODEL", "OPENROUTER_BLOTATO_SCRIPT_MODEL"],
  [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_BLOTATO_SCRIPT"]
);



const meta = provider("meta", ["OPENROUTER_META"], [...SHARED_OPENROUTER_KEY, "OPENROUTER_API_KEY_META"]);
const art = provider("art", ["OPENROUTER_ART", "OPENROUTER_ART_BACKUP"], [...SHARED_OPENROUTER_KEY, ...ART_OPENROUTER_KEY_FALLBACKS]);
// Seedream 4.5 is the production artwork primary. FLUX.2 Pro is the
// deliberately different backup family; Recraft V4.1 was removed after
// repeated production 404s, and Nano Banana is avoided for this artwork
// route because its observed output skewed too corporate for the brand.
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
  chatgpt: gpt56Sol,
  blotatoScript,
  anthropic: anthropic46,
  meta,
  art,
  artworkPrimary,
  artworkBackup,
  anthropic46,
  google25FlashLite,
  claudeSonnet5,
  claudeOpus47,
  gpt56Sol,
  commsFreePrimary,
  commsFreeBackup,
  commsFreeFallback,
  commsPaidEconomy,
  commsPaidPrimary,
  commsPaidBackup,
  commsPaidFallback,
  outreachWriter,
  outreachReviewer,
  outreachFallback,
  newsletterEditorial,
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

function fixedRouteChain(providerIds) {
  // Podcast quality routes are policy-critical. Keep their provider order stable
  // regardless of which secrets happened to be present when this module loaded;
  // ai-service resolves/skips unavailable providers at request time.
  return providerIds.filter((id, index) => providerIds.indexOf(id) === index);
}

const commsRoutineProviderIds = [
  "commsFreePrimary",
  "commsFreeBackup",
  "commsFreeFallback",
  "commsPaidEconomy",
];

export const aiConfig = {
  models: modelRegistry,

  routeModels: {
    intro: routeChain(["fast", "standard", "fallback"], ["google25FlashLite", "gpt56Sol", "meta"]),
    main: routeChain(["standard", "fast", "fallback"], ["google25FlashLite", "gpt56Sol"]),
    outro: routeChain(["fast", "standard", "fallback"], ["google25FlashLite", "gpt56Sol", "meta"]),
    scriptIntro: fixedRouteChain(["claudeSonnet5", "anthropic46", "highQuality", "standard", "gpt56Sol", "google25FlashLite", "meta"]),
    scriptMain: fixedRouteChain(["claudeSonnet5", "anthropic46", "highQuality", "standard", "gpt56Sol", "google25FlashLite"]),
    scriptMainSynthesis: fixedRouteChain(["claudeSonnet5", "gpt56Sol", "claudeOpus47"]),
    scriptOutro: fixedRouteChain(["claudeSonnet5", "anthropic46", "highQuality", "standard", "gpt56Sol", "google25FlashLite", "meta"]),
    compose: routeChain(["highQuality", "standard", "fallback"], ["anthropic46", "gpt56Sol", "google25FlashLite"]),
    editorialPass: fixedRouteChain(["claudeOpus47", "gpt56Sol", "claudeSonnet5"]),
    editAndFormat: routeChain(["standard", "fast", "fallback"], ["gpt56Sol", "google25FlashLite"]),
    metadata: routeChain(["summary", "json", "fast", "fallback"], ["google25FlashLite", "gpt56Sol"]),
    podcastHelper: routeChain(["summary", "fast", "fallback"], ["google25FlashLite", "gpt56Sol", "meta"]),
    seoKeywords: routeChain(["summary", "fast", "fallback"], ["google25FlashLite", "gpt56Sol"]),
    artworkPrompt: routeChain(["summary", "fast", "fallback"], ["meta", "google25FlashLite"]),
    artworkImage: routeChain(["image"], ["artworkPrimary", "artworkBackup"]),
    artworkVisualQa: routeChain(["audit", "highQuality"], ["claudeSonnet5", "anthropic46", "gpt56Sol"]),
    blotatoVisualQa: routeChain(["audit", "highQuality"], ["claudeSonnet5", "anthropic46", "gpt56Sol"]),
    rssRewrite: routeChain(["standard", "fast", "fallback"], ["gpt56Sol", "google25FlashLite"]),
    rssShortTitle: routeChain(["fast", "summary", "fallback"], ["google25FlashLite", "gpt56Sol"]),
    blogWeekly: routeChain(["standard", "summary", "fallback"], ["google25FlashLite", "gpt56Sol"]),
    blogSocial: routeChain(["highQuality", "audit", "standard", "summary", "fallback"], ["claudeSonnet5", "anthropic46", "google25FlashLite"]),
    onBrandAudit: routeChain(["audit", "highQuality", "standard", "fallback"], ["anthropic46", "gpt56Sol", "google25FlashLite", "meta"]),
    auditForensic: routeChain(["audit", "highQuality", "standard", "fallback"], ["anthropic46", "gpt56Sol", "google25FlashLite", "meta"]),
    zernioDaily: routeChain(["highQuality", "standard", "fast", "fallback"], ["claudeSonnet5", "anthropic46", "google25FlashLite"]),
    zernioMiniSeriesResearch: routeChain(["audit", "highQuality", "standard"], ["claudeSonnet5", "anthropic46"]),
    zernioMiniSeriesTheme: routeChain(["highQuality", "audit", "standard"], ["claudeSonnet5", "anthropic46"]),
    zernioMiniSeriesPost: routeChain(["highQuality", "standard", "audit"], ["claudeSonnet5", "anthropic46"]),
    zernioQuiz: routeChain(["highQuality", "standard", "fast", "fallback"], ["gpt56Sol", "google25FlashLite"]),
    zernioEbook: routeChain(["highQuality", "standard", "fast", "fallback"], ["gpt56Sol", "google25FlashLite"]),
    zernioPodcastPromo: routeChain(["highQuality", "standard", "fallback"], ["gpt56Sol", "google25FlashLite"]),
    // Blotato script quality is production-critical. highQuality sits above standard so Claude 4.6
    // is the first fallback after the dedicated blotatoScript provider, ahead of the lower-cost fallback lane.
    blotatoNewsShort: routeChain(["blotatoScript", "highQuality", "standard", "fallback"], ["anthropic46", "gpt56Sol", "google25FlashLite"]),
    // Newsletter engine (services/newsletter). Composition needs the same
    // editorial quality bar as the blog; QA review is intentionally routed
    // through a different provider than composition so the reviewer isn't
    // just re-approving its own output.
    // AI Edge uses task-specific routes. Sonnet handles editorial writing/voice,
    // GPT-5.6 Sol provides an independent premium fallback, while Gemini handles
    // low-latency subject work. Each route retains provider
    // failover through the shared resilient requester.
    newsletterCompose: routeChain(["newsletterEditorial", "highQuality"], ["gpt56Sol", "claudeOpus47"]),
    newsletterSubject: routeChain(["fast", "summary", "highQuality"], ["google25FlashLite", "gpt56Sol"]),
    newsletterFactCheck: routeChain(["audit", "highQuality"], ["claudeSonnet5", "anthropic46"]),
    newsletterVoiceReview: routeChain(["newsletterEditorial", "highQuality"], ["gpt56Sol", "anthropic46"]),
    newsletterAudienceReview: routeChain(["highQuality", "audit"], ["claudeSonnet5", "anthropic46"]),
    newsletterCouncilChair: routeChain(["audit", "highQuality"], ["claudeSonnet5", "anthropic46"]),
    newsletterHeroPrompt: routeChain(["summary", "fast", "fallback"], ["meta", "google25FlashLite"]),
    // Comms Hub: routine communications are free-first and privacy-gated.
    // Production order is GLM 5.2 Free -> Dots3-Note Free -> paid economy safety net.
    // An optional third free fallback is included only when explicitly configured.
    commsHubTriage: routeChain(commsRoutineProviderIds, []),
    commsHubModeration: routeChain(commsRoutineProviderIds, []),
    commsHubSummary: routeChain(commsRoutineProviderIds, []),
    commsHubDraft: routeChain(commsRoutineProviderIds, []),
    commsHubDraftContact: routeChain(commsRoutineProviderIds, []),
    commsHubDraftContribute: routeChain(commsRoutineProviderIds, []),
    commsHubDraftPodcast: routeChain(commsRoutineProviderIds, []),
    commsHubDraftSocial: routeChain(commsRoutineProviderIds, []),
    commsHubFollowUp: routeChain(commsRoutineProviderIds, []),
    commsHubDraftComplex: routeChain(["commsPaidPrimary", "commsPaidBackup", "commsPaidFallback"], []),
    // Outreach guest-article acquisition is deliberately premium. Discovery stays deterministic;
    // only pitch/reply/article writing uses these paid quality routes. Names retain the commsHub
    // prefix so OpenRouter ZDR/data_collection=deny policy remains mandatory.
    commsHubOutreachPitch: routeChain(["outreachWriter"], ["outreachFallback"]),
    commsHubOutreachReply: routeChain(["outreachWriter"], ["outreachFallback"]),
    commsHubOutreachArticle: routeChain(["outreachWriter"], ["outreachFallback"]),
    commsHubOutreachArticleReview: routeChain(["outreachReviewer"], ["outreachFallback"]),
  },

  commonParams: { temperature: 0.65, top_p: 0.9, timeout: 90000 },

  headers: {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || process.env.APP_URL || "http://localhost:3000",
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || process.env.APP_TITLE || "AI Management Suite",
  },
};

export default aiConfig;
