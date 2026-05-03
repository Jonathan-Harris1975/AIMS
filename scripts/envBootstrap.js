// scripts/envBootstrap.js
import process from "process";

/* ============================================================
   Helpers
============================================================ */
const req = (k) => {
  const v = process.env[k];
  if (v === undefined || String(v).trim() === "") {
    throw new Error(`Missing env: ${k}`);
  }
  return v;
};

const opt = (k, d = undefined) => {
  const v = process.env[k];
  return v === undefined ? d : v;
};

const str = (k, d = undefined) => {
  const raw = opt(k, d);
  if (raw === undefined || raw === null) return raw;
  return String(raw).trim();
};

const firstDefined = (...keys) => {
  for (const key of keys) {
    if (process.env[key] !== undefined && String(process.env[key]).trim() !== "") {
      return String(process.env[key]).trim();
    }
  }
  return undefined;
};

const num = (k, d = undefined) => {
  const raw = opt(k, d);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) {
    throw new Error(`Env ${k} must be numeric (got "${raw}")`);
  }
  return n;
};

const bool = (k, d = undefined) => {
  const raw = opt(k, d);
  if (raw === undefined) return undefined;
  return ["1", "true", "yes", "on", "y"].includes(
    String(raw).toLowerCase()
  );
};

/* ============================================================
   ENV (Authoritative Contract)
============================================================ */
export const ENV = {
  /* ---------------- Core ---------------- */
  NODE_ENV: str("NODE_ENV", "development").toLowerCase(),
  PORT: num("PORT", 3000),
  LOG_LEVEL: str("LOG_LEVEL", "info"),
  APP_TITLE: str("APP_TITLE"),
  APP_URL: str("APP_URL"),

  DEBUG_ROUTES: bool("DEBUG_ROUTES", false),
  AUTO_CALL: opt("AUTO_CALL", "yes"),

  /* ---------------- AI runtime ---------------- */
  AI_MAX_RETRIES: num("AI_MAX_RETRIES", 5),
  AI_MAX_TOKENS: num("AI_MAX_TOKENS", 4096),
  AI_RETRY_BASE_MS: num("AI_RETRY_BASE_MS", 500),
  AI_TEMPERATURE: num("AI_TEMPERATURE", 0.85),
  AI_TIMEOUT: num("AI_TIMEOUT", 60000),
  AI_TOP_P: num("AI_TOP_P", 0.9),

  /* ---------------- OpenRouter ---------------- */
  OPENROUTER_API_BASE: str("OPENROUTER_API_BASE"),

  // Versioned API keys
  OPENROUTER_API_KEY_ART_BACKUP:           opt("OPENROUTER_API_KEY_ART_BACKUP"),
  "OPENROUTER_API_KEY_GOOGLE_2-5_flashlite": opt("OPENROUTER_API_KEY_GOOGLE_2-5_flashlite"),
  OPENROUTER_API_KEY_CHATGPT_mini5:        opt("OPENROUTER_API_KEY_CHATGPT_mini5"),
  OPENROUTER_API_KEY_DEEPSEEK_v4_pro:      opt("OPENROUTER_API_KEY_DEEPSEEK_v4_pro"),
  OPENROUTER_API_KEY_DEEPSEEK_v4_flash:    opt("OPENROUTER_API_KEY_DEEPSEEK_v4_flash"),
  "OPENROUTER_API_KEY_ANTHROPIC_4-6":      opt("OPENROUTER_API_KEY_ANTHROPIC_4-6"),
  OPENROUTER_API_KEY_META:                 opt("OPENROUTER_API_KEY_META"),

  // Versioned model identifiers
  OPENROUTER_ART_BACKUP:             opt("OPENROUTER_ART_BACKUP"),
  "OPENROUTER_GOOGLE_2-5_flashlite": opt("OPENROUTER_GOOGLE_2-5_flashlite"),
  "OPENROUTER_CHATGPT_mini-5":       opt("OPENROUTER_CHATGPT_mini-5"),
  OPENROUTER_DEEPSEEK_v4_pro:        opt("OPENROUTER_DEEPSEEK_v4_pro"),
  OPENROUTER_DEEPSEEK_v4_flash:      opt("OPENROUTER_DEEPSEEK_v4_flash"),
  "OPENROUTER_ANTHROPIC_4-6":        opt("OPENROUTER_ANTHROPIC_4-6"),
  OPENROUTER_META:                   opt("OPENROUTER_META"),

  /* ---------------- RapidAPI ---------------- */
  RAPIDAPI_HOST: str("RAPIDAPI_HOST"),
  RAPIDAPI_KEY: str("RAPIDAPI_KEY"),

  /* ---------------- Outreach APIs ---------------- */
  API_SERP_KEY: opt("API_SERP_KEY"),
  API_OPENPAGERANK_KEY: opt("API_OPENPAGERANK_KEY"),
  API_URLSCAN_KEY: opt("API_URLSCAN_KEY"),
  API_PROSPEO_KEY: opt("API_PROSPEO_KEY"),
  API_HUNTER_KEY: opt("API_HUNTER_KEY"),
  API_APOLLO_KEY: opt("API_APOLLO_KEY"),
  API_ZERO_KEY: opt("API_ZERO_KEY"),

  /* ---------------- Outreach timing & policy ---------------- */
  SERP_RATE_DELAY_MS: num("SERP_RATE_DELAY_MS"),
  URLSCAN_DELAY_MS: num("URLSCAN_DELAY_MS"),
  APOLLO_DELAY_MS: num("APOLLO_DELAY_MS"),
  HUNTER_DELAY_MS: num("HUNTER_DELAY_MS"),

  RETRY_DELAY_MS: num("RETRY_DELAY_MS"),
  RETRY_BACKOFF_MULTIPLIER: num("RETRY_BACKOFF_MULTIPLIER"),

  SERP_RESULT_LIMIT: num("SERP_RESULT_LIMIT", 30),
  OUTREACH_BATCH_SIZE: num("OUTREACH_BATCH_SIZE"),

  OUTREACH_MIN_LEAD_SCORE: num("OUTREACH_MIN_LEAD_SCORE"),
  OUTREACH_MIN_EMAIL_SCORE: num("OUTREACH_MIN_EMAIL_SCORE"),

  /* ---------------- Feed / RSS ---------------- */
  FEED_URL: str("FEED_URL"),
  FEED_CUTOFF_HOURS: num("FEED_CUTOFF_HOURS", 48),
  FEED_FRESHNESS_HOURS: num("FEED_FRESHNESS_HOURS", 24),
  FEED_RETENTION_DAYS: num("FEED_RETENTION_DAYS", 60),

  RSS_FEED_TITLE: opt("RSS_FEED_TITLE"),
  RSS_FEED_DESCRIPTION: opt("RSS_FEED_DESCRIPTION"),

  RSS_MIN_SOURCE_CHARS: num("RSS_MIN_SOURCE_CHARS", 220),
  RSS_TOPIC_GUARD_MIN_SHARED: num("RSS_TOPIC_GUARD_MIN_SHARED", 2),
  RSS_TOPIC_GUARD_MIN_OVERLAP: num("RSS_TOPIC_GUARD_MIN_OVERLAP", 0.12),

  /* ---------------- Podcast metadata ---------------- */
  PODCAST_TITLE: str("PODCAST_TITLE"),
  PODCAST_AUTHOR: str("PODCAST_AUTHOR"),
  PODCAST_DESCRIPTION: str("PODCAST_DESCRIPTION"),
  PODCAST_LINK: str("PODCAST_LINK"),
  PODCAST_LANGUAGE: (str("PODCAST_LANGUAGE", "en-gb") || "en-gb").toLowerCase().replace("en-uk", "en-gb"),
  PODCAST_EXPLICIT: bool("PODCAST_EXPLICIT", false),

  PODCAST_CATEGORY_1: opt("PODCAST_CATEGORY_1"),
  PODCAST_CATEGORY_2: opt("PODCAST_CATEGORY_2"),
  PODCAST_COPYRIGHT: opt("PODCAST_COPYRIGHT"),
  PODCAST_IMAGE_URL: opt("PODCAST_IMAGE_URL"),
  PODCAST_OWNER_NAME: opt("PODCAST_OWNER_NAME"),
  PODCAST_OWNER_EMAIL: opt("PODCAST_OWNER_EMAIL"),
  PODCASTINDEX_USER_AGENT: str("PODCASTINDEX_USER_AGENT"),

  PODCAST_INTRO_URL: opt("PODCAST_INTRO_URL"),
  PODCAST_OUTRO_URL: opt("PODCAST_OUTRO_URL"),

  PODCAST_FFMPEG_TIMEOUT_MS: num("PODCAST_FFMPEG_TIMEOUT_MS", 900000),
  PODCAST_RSS_EP: opt("PODCAST_RSS_EP", "Yes"),
  PODCAST_RSS_ENABLED: opt("PODCAST_RSS_ENABLED", "yes"),

  API_KEY_PODCAST_INDEX: opt("API_KEY_PODCAST_INDEX"),
  API_SECRET_PODCAST_INDEX: opt("API_SECRET_PODCAST_INDEX"),

  /* ---------------- Polly / TTS ---------------- */
  POLLY_VOICE_ID: opt("POLLY_VOICE_ID", "Brian"),
  TTS_CONCURRENCY: num("TTS_CONCURRENCY", 3),
  BLOG_RSS_OBJECT_KEY: opt("BLOG_RSS_OBJECT_KEY", "feed.xml"),
  MAX_POLLY_NATURAL_CHUNK_CHARS: num("MAX_POLLY_NATURAL_CHUNK_CHARS", 2800),
  MAX_CHUNK_RETRIES: num("MAX_CHUNK_RETRIES", 5),
  MAX_SUMMARY_CHARS: num("MAX_SUMMARY_CHARS", 2400),
  MIN_SUMMARY_CHARS: num("MIN_SUMMARY_CHARS", 900),

  /* ---------------- R2 ---------------- */
  R2_ENDPOINT: opt("R2_ENDPOINT"),
  R2_REGION: opt("R2_REGION", "auto"),
  R2_ACCESS_KEY_ID: opt("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: opt("R2_SECRET_ACCESS_KEY"),

  R2_BUCKET_PODCAST: opt("R2_BUCKET_PODCAST"),
  R2_BUCKET_RAW_TEXT: opt("R2_BUCKET_RAW_TEXT"),
  R2_BUCKET_CHUNKS: opt("R2_BUCKET_CHUNKS"), // raw TTS audio
  R2_BUCKET_RAW: opt("R2_BUCKET_RAW"),       // alias → same bucket
  R2_BUCKET_META: opt("R2_BUCKET_META"),
  R2_BUCKET_META_SYSTEM: opt("R2_BUCKET_META_SYSTEM"),
  R2_BUCKET_MERGED: opt("R2_BUCKET_MERGED"),
  R2_BUCKET_EDITED_AUDIO: opt("R2_BUCKET_EDITED_AUDIO"),
  R2_BUCKET_TRANSCRIPTS: opt("R2_BUCKET_TRANSCRIPTS"),
  R2_BUCKET_RSS_FEEDS: opt("R2_BUCKET_RSS_FEEDS"),
  R2_BUCKET_PODCAST_RSS_FEEDS: opt("R2_BUCKET_PODCAST_RSS_FEEDS"),
  R2_BUCKET_ART: opt("R2_BUCKET_ART"),
  R2_BUCKET_BLOG: opt("R2_BUCKET_BLOG"),
  R2_BUCKET_BLOG_IMAGES: opt("R2_BUCKET_BLOG_IMAGES"),
  R2_BUCKET_BLOG_RSS: opt("R2_BUCKET_BLOG_RSS"),

  R2_PUBLIC_BASE_URL_PODCAST: opt("R2_PUBLIC_BASE_URL_PODCAST"),
  R2_PUBLIC_BASE_URL_RAW_TEXT: opt("R2_PUBLIC_BASE_URL_RAW_TEXT"),
  R2_PUBLIC_BASE_URL_META: opt("R2_PUBLIC_BASE_URL_META"),
  R2_PUBLIC_BASE_URL_MERGE: opt("R2_PUBLIC_BASE_URL_MERGE"),
  R2_PUBLIC_BASE_URL_RSS: opt("R2_PUBLIC_BASE_URL_RSS"),
  R2_PUBLIC_BASE_URL_ART: opt("R2_PUBLIC_BASE_URL_ART"),
  R2_PUBLIC_BASE_URL_CHUNKS: opt("R2_PUBLIC_BASE_URL_CHUNKS"),
  R2_PUBLIC_BASE_URL_EDITED_AUDIO: opt("R2_PUBLIC_BASE_URL_EDITED_AUDIO"),
  R2_PUBLIC_BASE_URL_PODCAST_RSS: opt("R2_PUBLIC_BASE_URL_PODCAST_RSS"),
  R2_PUBLIC_BASE_URL_TRANSCRIPT: opt("R2_PUBLIC_BASE_URL_TRANSCRIPT"),
  R2_PUBLIC_BASE_URL_META_SYSTEM: opt("R2_PUBLIC_BASE_URL_META_SYSTEM"),
  R2_PUBLIC_BASE_URL_BLOG: opt("R2_PUBLIC_BASE_URL_BLOG"),
  R2_PUBLIC_BASE_URL_BLOG_IMAGES: opt("R2_PUBLIC_BASE_URL_BLOG_IMAGES"),
  R2_PUBLIC_BASE_URL_BLOG_RSS: opt("R2_PUBLIC_BASE_URL_BLOG_RSS"),

  /* ---------------- Google Sheets ---------------- */
  GOOGLE_CLIENT_EMAIL: str("GOOGLE_CLIENT_EMAIL"),
  GOOGLE_PRIVATE_KEY: opt("GOOGLE_PRIVATE_KEY"),
  GOOGLE_SHEET_ID: str("GOOGLE_SHEET_ID"),

  /* ---------------- Funding / iTunes ---------------- */
  PODCAST_RSS_FEED_URL: firstDefined("PODCAST_RSS_FEED_URL"),
  PODCAST_FUNDING_TEXT: firstDefined("PODCAST_FUNDING_TEXT", "funding_text"),
  PODCAST_FUNDING_URL: firstDefined("PODCAST_FUNDING_URL", "funding_url"),
  PODCAST_ITUNES_KEYWORDS: firstDefined("PODCAST_ITUNES_KEYWORDS", "itunes_keywords"),
  PODCAST_ITUNES_TYPE: firstDefined("PODCAST_ITUNES_TYPE", "itunes_type"),
  funding_text: firstDefined("funding_text", "PODCAST_FUNDING_TEXT"),
  funding_url: firstDefined("funding_url", "PODCAST_FUNDING_URL"),
  itunes_keywords: firstDefined("itunes_keywords", "PODCAST_ITUNES_KEYWORDS"),
  itunes_type: firstDefined("itunes_type", "PODCAST_ITUNES_TYPE"),

  /* ---------------- Short.io ---------------- */
  SHORTIO_API_KEY: opt("SHORTIO_API_KEY"),
  SHORTIO_DOMAIN: opt("SHORTIO_DOMAIN"),

  /* ---------------- Podcast extras ---------------- */
  PODCAST_EPISODE_BASE_URL:           opt("PODCAST_EPISODE_BASE_URL"),
  PODCAST_TRANSCRIPT_HTML_BASE_URL:   opt("PODCAST_TRANSCRIPT_HTML_BASE_URL"),
  PODCAST_RSS_ENABLED:                opt("PODCAST_RSS_ENABLED", "yes"),
  PODCAST_RETRY_DELAY_MS:             num("PODCAST_RETRY_DELAY_MS", 2500),
  ENABLE_FADES:                       bool("ENABLE_FADES", false),
  ENABLE_EDITORIAL_PASS:              opt("ENABLE_EDITORIAL_PASS", "yes"),
  MAX_EDIT_RETRIES:                   num("MAX_EDIT_RETRIES", 5),
  EDIT_RETRY_DELAY_MS:                num("EDIT_RETRY_DELAY_MS", 2500),
  MAX_PODCAST_RETRIES:                num("MAX_PODCAST_RETRIES", 5),
  MAX_TOTAL_ITEMS:                    num("MAX_TOTAL_ITEMS", 500),
  MAX_FEEDS_PER_RUN:                  num("MAX_FEEDS_PER_RUN", 50),
  MAX_DOMAINS_PER_KEYWORD:            num("MAX_DOMAINS_PER_KEYWORD", 30),
  MIN_INTRO_DURATION:                 num("MIN_INTRO_DURATION", 0.08),
  MIN_OUTRO_DURATION:                 num("MIN_OUTRO_DURATION", 0.08),

  /* ---------------- R2 extras ---------------- */
  R2_BUCKET_BRAND_ASSETS:               opt("R2_BUCKET_BRAND_ASSETS", "brand-assets"),
  R2_PUBLIC_BASE_URL_BRAND_ASSETS:      opt("R2_PUBLIC_BASE_URL_BRAND_ASSETS"),
  R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML:   opt("R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML"),

  /* ---------------- Site / Audits ---------------- */
  SITE_BASE_URL:               opt("SITE_BASE_URL"),
  GITHUB_TOKEN_WEBSITE_AUDITS: opt("GITHUB_TOKEN_WEBSITE_AUDITS"),
  AUDIT_CALLBACK_TOKEN:        opt("AUDIT_CALLBACK_TOKEN"),
  AUDIT_WEBSITE_REPO_NAME:     opt("AUDIT_WEBSITE_REPO_NAME"),
  AUDIT_WEBSITE_REPO_OWNER:    opt("AUDIT_WEBSITE_REPO_OWNER"),
  AUDIT_WEBSITE_REPO_REF:      opt("AUDIT_WEBSITE_REPO_REF", "main"),
  BACKFILL_TRANSCRIPT_HTML:    bool("BACKFILL_TRANSCRIPT_HTML", false),

  /* ---------------- AWS ---------------- */
  AWS_REGION: opt("AWS_REGION", "eu-west-2"),
  AWS_ACCESS_KEY_ID: opt("AWS_ACCESS_KEY_ID"),
  AWS_SECRET_ACCESS_KEY: opt("AWS_SECRET_ACCESS_KEY"),
};
