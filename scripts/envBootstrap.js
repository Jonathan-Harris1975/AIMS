// scripts/envBootstrap.js
import process from "process";

const req = (k) => {
  if (!process.env[k] || process.env[k].trim() === "") {
    throw new Error(`Missing env: ${k}`);
  }
  return process.env[k];
};

const opt = (k, d) =>
  process.env[k] !== undefined ? process.env[k] : d;

const num = (k, d) => {
  if (process.env[k] === undefined) return d;
  const v = Number(process.env[k]);
  if (Number.isNaN(v)) throw new Error(`Env ${k} must be numeric`);
  return v;
};

const bool = (k, d = false) => {
  if (process.env[k] === undefined) return d;
  return ["1", "true", "yes", "on"].includes(process.env[k].toLowerCase());
};

export const ENV = {
  NODE_ENV: req("NODE_ENV"),
  PORT: num("PORT", 3000),
  LOG_LEVEL: opt("LOG_LEVEL", "info"),

  APP_TITLE: req("APP_TITLE"),
  APP_URL: opt("APP_URL"),

  INTERNAL_BASE_PROTO: req("INTERNAL_BASE_PROTO"),
  INTERNAL_BASE_HOST: req("INTERNAL_BASE_HOST"),

  ENABLE_FADES: bool("ENABLE_FADES"),
  ENABLE_EDITORIAL_PASS: bool("ENABLE_EDITORIAL_PASS"),
  AUTO_CALL: bool("AUTO_CALL"),
  DEBUG_ROUTES: bool("DEBUG_ROUTES"),

  /* AI */
  AI_MAX_RETRIES: num("AI_MAX_RETRIES"),
  AI_MAX_TOKENS: num("AI_MAX_TOKENS"),
  AI_RETRY_BASE_MS: num("AI_RETRY_BASE_MS"),
  AI_TIMEOUT: num("AI_TIMEOUT"),
  AI_TEMPERATURE: Number(req("AI_TEMPERATURE")),
  AI_TOP_P: Number(req("AI_TOP_P")),

  /* OpenRouter */
  OPENROUTER_API_BASE: req("OPENROUTER_API_BASE"),
  OPENROUTER_ANTHROPIC: req("OPENROUTER_ANTHROPIC"),
  OPENROUTER_CHATGPT: req("OPENROUTER_CHATGPT"),
  OPENROUTER_DEEPSEEK: req("OPENROUTER_DEEPSEEK"),
  OPENROUTER_GOOGLE: req("OPENROUTER_GOOGLE"),
  OPENROUTER_META: req("OPENROUTER_META"),
  OPENROUTER_ART: req("OPENROUTER_ART"),

  OPENROUTER_API_KEY_ANTHROPIC: req("OPENROUTER_API_KEY_ANTHROPIC"),
  OPENROUTER_API_KEY_CHATGPT: req("OPENROUTER_API_KEY_CHATGPT"),
  OPENROUTER_API_KEY_DEEPSEEK: req("OPENROUTER_API_KEY_DEEPSEEK"),
  OPENROUTER_API_KEY_GOOGLE: req("OPENROUTER_API_KEY_GOOGLE"),
  OPENROUTER_API_KEY_META: req("OPENROUTER_API_KEY_META"),
  OPENROUTER_API_KEY_ART: req("OPENROUTER_API_KEY_ART"),

  /* Podcast */
  PODCAST_TITLE: req("PODCAST_TITLE"),
  PODCAST_AUTHOR: req("PODCAST_AUTHOR"),
  PODCAST_DESCRIPTION: req("PODCAST_DESCRIPTION"),
  PODCAST_LANGUAGE: req("PODCAST_LANGUAGE"),
  PODCAST_LINK: req("PODCAST_LINK"),
  PODCAST_IMAGE_URL: req("PODCAST_IMAGE_URL"),
  PODCAST_EXPLICIT: bool("PODCAST_EXPLICIT"),
  PODCAST_OWNER_NAME: req("PODCAST_OWNER_NAME"),
  PODCAST_OWNER_EMAIL: req("PODCAST_OWNER_EMAIL"),
  PODCAST_COPYRIGHT: req("PODCAST_COPYRIGHT"),
  PODCAST_CATEGORY_1: req("PODCAST_CATEGORY_1"),
  PODCAST_CATEGORY_2: req("PODCAST_CATEGORY_2"),
  PODCAST_INTRO_URL: req("PODCAST_INTRO_URL"),
  PODCAST_OUTRO_URL: req("PODCAST_OUTRO_URL"),
  PODCAST_RETRY_DELAY_MS: num("PODCAST_RETRY_DELAY_MS"),
  PODCAST_FFMPEG_TIMEOUT_MS: num("PODCAST_FFMPEG_TIMEOUT_MS"),
  PODCAST_RSS_ENABLED: bool("PODCAST_RSS_ENABLED"),
  PODCAST_RSS_EP: bool("PODCAST_RSS_EP"),
  PODCASTINDEX_USER_AGENT: req("PODCASTINDEX_USER_AGENT"),

  /* RSS */
  RSS_FEED_TITLE: req("RSS_FEED_TITLE"),
  RSS_FEED_DESCRIPTION: req("RSS_FEED_DESCRIPTION"),
  RSS_MIN_SOURCE_CHARS: num("RSS_MIN_SOURCE_CHARS"),
  RSS_TOPIC_GUARD_MIN_SHARED: num("RSS_TOPIC_GUARD_MIN_SHARED"),
  RSS_TOPIC_GUARD_MIN_OVERLAP: Number(req("RSS_TOPIC_GUARD_MIN_OVERLAP")),

  /* Feeds */
  FEED_URL: req("FEED_URL"),
  FEED_CUTOFF_HOURS: num("FEED_CUTOFF_HOURS"),
  FEED_FRESHNESS_HOURS: num("FEED_FRESHNESS_HOURS"),
  FEED_RETENTION_DAYS: num("FEED_RETENTION_DAYS"),

  /* Limits / retries */
  EDIT_RETRY_DELAY_MS: num("EDIT_RETRY_DELAY_MS"),
  RETRY_DELAY_MS: num("RETRY_DELAY_MS"),
  RETRY_BACKOFF_MULTIPLIER: num("RETRY_BACKOFF_MULTIPLIER"),
  MAX_EDIT_RETRIES: num("MAX_EDIT_RETRIES"),
  MAX_PODCAST_RETRIES: num("MAX_PODCAST_RETRIES"),
  MAX_CHUNK_RETRIES: num("MAX_CHUNK_RETRIES"),
  MAX_SUMMARY_CHARS: num("MAX_SUMMARY_CHARS"),
  MIN_SUMMARY_CHARS: num("MIN_SUMMARY_CHARS"),
  MIN_INTRO_DURATION: Number(req("MIN_INTRO_DURATION")),
  MIN_OUTRO_DURATION: Number(req("MIN_OUTRO_DURATION")),
  MAX_FEEDS_PER_RUN: num("MAX_FEEDS_PER_RUN"),
  MAX_ITEMS_PER_FEED: num("MAX_ITEMS_PER_FEED"),
  MAX_TOTAL_ITEMS: num("MAX_TOTAL_ITEMS"),
  MAX_RSS_FEEDS_PER_RUN: num("MAX_RSS_FEEDS_PER_RUN"),
  MAX_URL_FEEDS_PER_RUN: num("MAX_URL_FEEDS_PER_RUN"),

  /* Outreach */
  OUTREACH_BATCH_SIZE: num("OUTREACH_BATCH_SIZE"),
  SERP_RESULT_LIMIT: num("SERP_RESULT_LIMIT"),
  SERP_RATE_DELAY_MS: num("SERP_RATE_DELAY_MS"),
  MAX_DOMAINS_PER_KEYWORD: num("MAX_DOMAINS_PER_KEYWORD"),
  APOLLO_DELAY_MS: num("APOLLO_DELAY_MS"),
  HUNTER_DELAY_MS: num("HUNTER_DELAY_MS"),
  URLSCAN_DELAY_MS: num("URLSCAN_DELAY_MS"),

  /* APIs */
  API_SERP_KEY: req("API_SERP_KEY"),
  API_OPENPAGERANK_KEY: req("API_OPENPAGERANK_KEY"),
  API_APOLLO_KEY: req("API_APOLLO_KEY"),
  API_HUNTER_KEY: req("API_HUNTER_KEY"),
  API_PROSPEO_KEY: req("API_PROSPEO_KEY"),
  API_URLSCAN_KEY: req("API_URLSCAN_KEY"),
  API_ZERO_KEY: req("API_ZERO_KEY"),
  API_KEY_PODCAST_INDEX: req("API_KEY_PODCAST_INDEX"),
  API_SECRET_PODCAST_INDEX: req("API_SECRET_PODCAST_INDEX"),

  /* R2 */
  R2_ENDPOINT: req("R2_ENDPOINT"),
  R2_REGION: req("R2_REGION"),
  R2_ACCESS_KEY_ID: req("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: req("R2_SECRET_ACCESS_KEY"),

  /* AWS */
  AWS_ACCESS_KEY_ID: req("AWS_ACCESS_KEY_ID"),
  AWS_SECRET_ACCESS_KEY: req("AWS_SECRET_ACCESS_KEY"),
  AWS_REGION: req("AWS_REGION"),
  POLLY_VOICE_ID: req("POLLY_VOICE_ID"),

  TTS_CONCURRENCY: num("TTS_CONCURRENCY"),
  MAX_POLLY_NATURAL_CHUNK_CHARS: num("MAX_POLLY_NATURAL_CHUNK_CHARS"),
};
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
