// scripts/envBootstrap.js
import process from "process";

/* ============================================================
   Helpers
============================================================ */
const required = (key) => {
  if (!process.env[key] || process.env[key].trim() === "") {
    throw new Error(`❌ Missing required env: ${key}`);
  }
  return process.env[key];
};

const optional = (key, def = undefined) =>
  process.env[key] !== undefined ? process.env[key] : def;

const bool = (key, def = false) => {
  const v = process.env[key];
  if (v === undefined) return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
};

const num = (key, def) => {
  if (process.env[key] === undefined) return def;
  const n = Number(process.env[key]);
  if (Number.isNaN(n)) {
    throw new Error(`❌ Env ${key} must be numeric`);
  }
  return n;
};

/* ============================================================
   Core
============================================================ */
export const ENV = {
  NODE_ENV: required("NODE_ENV"),
  PORT: num("PORT", 3000),
  LOG_LEVEL: optional("LOG_LEVEL", "info"),

  APP_TITLE: required("APP_TITLE"),
  APP_URL: optional("APP_URL"),

  INTERNAL_BASE_PROTO: optional("INTERNAL_BASE_PROTO", "http"),
  INTERNAL_BASE_HOST: optional("INTERNAL_BASE_HOST", "localhost"),

  /* ========================================================
     Feature flags
  ======================================================== */
  ENABLE_FADES: bool("ENABLE_FADES"),
  ENABLE_EDITORIAL_PASS: bool("ENABLE_EDITORIAL_PASS"),
  AUTO_CALL: bool("AUTO_CALL"),
  DEBUG_ROUTES: bool("DEBUG_ROUTES"),

  /* ========================================================
     AI config
  ======================================================== */
  AI_MAX_RETRIES: num("AI_MAX_RETRIES", 5),
  AI_MAX_TOKENS: num("AI_MAX_TOKENS", 4096),
  AI_RETRY_BASE_MS: num("AI_RETRY_BASE_MS", 500),
  AI_TIMEOUT: num("AI_TIMEOUT", 60000),
  AI_TEMPERATURE: Number(optional("AI_TEMPERATURE", 0.85)),
  AI_TOP_P: Number(optional("AI_TOP_P", 0.9)),

  OPENROUTER_API_BASE: required("OPENROUTER_API_BASE"),
  OPENROUTER_ANTHROPIC: required("OPENROUTER_ANTHROPIC"),
  OPENROUTER_CHATGPT: required("OPENROUTER_CHATGPT"),
  OPENROUTER_DEEPSEEK: required("OPENROUTER_DEEPSEEK"),
  OPENROUTER_GOOGLE: required("OPENROUTER_GOOGLE"),
  OPENROUTER_META: required("OPENROUTER_META"),

  OPENROUTER_API_KEY_ANTHROPIC: required("OPENROUTER_API_KEY_ANTHROPIC"),
  OPENROUTER_API_KEY_CHATGPT: required("OPENROUTER_API_KEY_CHATGPT"),
  OPENROUTER_API_KEY_DEEPSEEK: required("OPENROUTER_API_KEY_DEEPSEEK"),
  OPENROUTER_API_KEY_GOOGLE: required("OPENROUTER_API_KEY_GOOGLE"),
  OPENROUTER_API_KEY_META: required("OPENROUTER_API_KEY_META"),
  OPENROUTER_API_KEY_ART: required("OPENROUTER_API_KEY_ART"),
  OPENROUTER_ART: required("OPENROUTER_ART"),

  /* ========================================================
     Podcast / RSS
  ======================================================== */
  PODCAST_TITLE: required("PODCAST_TITLE"),
  PODCAST_AUTHOR: required("PODCAST_AUTHOR"),
  PODCAST_DESCRIPTION: required("PODCAST_DESCRIPTION"),
  PODCAST_LANGUAGE: required("PODCAST_LANGUAGE"),
  PODCAST_LINK: required("PODCAST_LINK"),
  PODCAST_IMAGE_URL: required("PODCAST_IMAGE_URL"),
  PODCAST_EXPLICIT: bool("PODCAST_EXPLICIT"),
  PODCAST_OWNER_NAME: required("PODCAST_OWNER_NAME"),
  PODCAST_OWNER_EMAIL: required("PODCAST_OWNER_EMAIL"),
  PODCAST_COPYRIGHT: required("PODCAST_COPYRIGHT"),

  PODCAST_CATEGORY_1: required("PODCAST_CATEGORY_1"),
  PODCAST_CATEGORY_2: required("PODCAST_CATEGORY_2"),

  PODCAST_RSS_ENABLED: bool("PODCAST_RSS_ENABLED"),
  PODCAST_RSS_EP: bool("PODCAST_RSS_EP"),

  PODCAST_RETRY_DELAY_MS: num("PODCAST_RETRY_DELAY_MS", 2500),
  PODCAST_FFMPEG_TIMEOUT_MS: num("PODCAST_FFMPEG_TIMEOUT_MS", 900000),

  PODCAST_INTRO_URL: required("PODCAST_INTRO_URL"),
  PODCAST_OUTRO_URL: required("PODCAST_OUTRO_URL"),

  /* ========================================================
     Feed / RSS ingestion
  ======================================================== */
  FEED_URL: required("FEED_URL"),
  FEED_CUTOFF_HOURS: num("FEED_CUTOFF_HOURS", 48),
  FEED_FRESHNESS_HOURS: num("FEED_FRESHNESS_HOURS", 24),
  FEED_RETENTION_DAYS: num("FEED_RETENTION_DAYS", 60),

  MAX_FEEDS_PER_RUN: num("MAX_FEEDS_PER_RUN", 30),
  MAX_ITEMS_PER_FEED: num("MAX_ITEMS_PER_FEED", 5),
  MAX_TOTAL_ITEMS: num("MAX_TOTAL_ITEMS", 500),
  MAX_RSS_FEEDS_PER_RUN: num("MAX_RSS_FEEDS_PER_RUN", 5),
  MAX_URL_FEEDS_PER_RUN: num("MAX_URL_FEEDS_PER_RUN", 1),

  RSS_FEED_TITLE: required("RSS_FEED_TITLE"),
  RSS_FEED_DESCRIPTION: required("RSS_FEED_DESCRIPTION"),

  funding_text: required("funding_text"),
  funding_url: required("funding_url"),

  itunes_keywords: required("itunes_keywords"),
  itunes_type: required("itunes_type"),

  /* ========================================================
     Outreach / SERP
  ======================================================== */
  OUTREACH_BATCH_SIZE: num("OUTREACH_BATCH_SIZE", 40),
  SERP_RESULT_LIMIT: num("SERP_RESULT_LIMIT", 30),
  MAX_DOMAINS_PER_KEYWORD: num("MAX_DOMAINS_PER_KEYWORD", 30),

  SERP_RATE_DELAY_MS: num("SERP_RATE_DELAY_MS", 1500),
  APOLLO_DELAY_MS: num("APOLLO_DELAY_MS", 900),
  HUNTER_DELAY_MS: num("HUNTER_DELAY_MS", 600),
  URLSCAN_DELAY_MS: num("URLSCAN_DELAY_MS", 2000),

  /* ========================================================
     API keys
  ======================================================== */
  API_SERP_KEY: required("API_SERP_KEY"),
  API_OPENPAGERANK_KEY: required("API_OPENPAGERANK_KEY"),
  API_APOLLO_KEY: required("API_APOLLO_KEY"),
  API_HUNTER_KEY: required("API_HUNTER_KEY"),
  API_PROSPEO_KEY: required("API_PROSPEO_KEY"),
  API_URLSCAN_KEY: required("API_URLSCAN_KEY"),
  API_ZERO_KEY: required("API_ZERO_KEY"),

  API_KEY_PODCAST_INDEX: required("API_KEY_PODCAST_INDEX"),
  API_SECRET_PODCAST_INDEX: required("API_SECRET_PODCAST_INDEX"),
  PODCASTINDEX_USER_AGENT: required("PODCASTINDEX_USER_AGENT"),

  /* ========================================================
     R2 / storage
  ======================================================== */
  R2_ENDPOINT: required("R2_ENDPOINT"),
  R2_REGION: required("R2_REGION"),
  R2_ACCESS_KEY_ID: required("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: required("R2_SECRET_ACCESS_KEY"),

  R2_BUCKET_PODCAST: required("R2_BUCKET_PODCAST"),
  R2_BUCKET_CHUNKS: required("R2_BUCKET_CHUNKS"),
  R2_BUCKET_EDITED_AUDIO: required("R2_BUCKET_EDITED_AUDIO"),
  R2_BUCKET_MERGED: required("R2_BUCKET_MERGED"),
  R2_BUCKET_META: required("R2_BUCKET_META"),
  R2_BUCKET_META_SYSTEM: required("R2_BUCKET_META_SYSTEM"),
  R2_BUCKET_TRANSCRIPTS: required("R2_BUCKET_TRANSCRIPTS"),
  R2_BUCKET_RAW_TEXT: required("R2_BUCKET_RAW_TEXT"),
  R2_BUCKET_ART: required("R2_BUCKET_ART"),
  R2_BUCKET_RSS_FEEDS: required("R2_BUCKET_RSS_FEEDS"),
  R2_BUCKET_PODCAST_RSS_FEEDS: required("R2_BUCKET_PODCAST_RSS_FEEDS"),

  R2_PUBLIC_BASE_URL_PODCAST: required("R2_PUBLIC_BASE_URL_PODCAST"),
  R2_PUBLIC_BASE_URL_CHUNKS: required("R2_PUBLIC_BASE_URL_CHUNKS"),
  R2_PUBLIC_BASE_URL_EDITED_AUDIO: required("R2_PUBLIC_BASE_URL_EDITED_AUDIO"),
  R2_PUBLIC_BASE_URL_MERGE: required("R2_PUBLIC_BASE_URL_MERGE"),
  R2_PUBLIC_BASE_URL_META: required("R2_PUBLIC_BASE_URL_META"),
  R2_PUBLIC_BASE_URL_META_SYSTEM: required("R2_PUBLIC_BASE_URL_META_SYSTEM"),
  R2_PUBLIC_BASE_URL_RAW_TEXT: required("R2_PUBLIC_BASE_URL_RAW_TEXT"),
  R2_PUBLIC_BASE_URL_TRANSCRIPT: required("R2_PUBLIC_BASE_URL_TRANSCRIPT"),
  R2_PUBLIC_BASE_URL_ART: required("R2_PUBLIC_BASE_URL_ART"),
  R2_PUBLIC_BASE_URL_RSS: required("R2_PUBLIC_BASE_URL_RSS"),
  R2_PUBLIC_BASE_URL_PODCAST_RSS: required("R2_PUBLIC_BASE_URL_PODCAST_RSS"),

  /* ========================================================
     AWS / Polly
  ======================================================== */
  AWS_ACCESS_KEY_ID: required("AWS_ACCESS_KEY_ID"),
  AWS_SECRET_ACCESS_KEY: required("AWS_SECRET_ACCESS_KEY"),
  AWS_REGION: required("AWS_REGION"),
  POLLY_VOICE_ID: required("POLLY_VOICE_ID"),

  /* ========================================================
     TTS / Audio
  ======================================================== */
  TTS_CONCURRENCY: num("TTS_CONCURRENCY", 3),
  MAX_POLLY_NATURAL_CHUNK_CHARS: num("MAX_POLLY_NATURAL_CHUNK_CHARS", 2800),
  MAX_CHUNK_RETRIES: num("MAX_CHUNK_RETRIES", 5),
  MAX_EDIT_RETRIES: num("MAX_EDIT_RETRIES", 5),
  MAX_PODCAST_RETRIES: num("MAX_PODCAST_RETRIES", 5),
};																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
																									
