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

const num = (k, d = undefined) => {
  const raw = opt(k, d);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (Number.isNaN(n)) {
    throw new Error(`Env ${k} must be numeric (got "${raw}")`);
  }
  return n;
};

const bool = (k, d = false) => {
  const raw = opt(k, d);
  if (raw === undefined) return undefined;
  return ["1", "true", "yes", "on", "y"].includes(
    String(raw).toLowerCase()
  );
};

/* ============================================================
   Canonical ENV Contract (Phase 2)
============================================================ */
export const ENV = {
  /* ---------------- Core ---------------- */
  core: {
    NODE_ENV: req("NODE_ENV"),
    PORT: num("PORT", 3000),
    LOG_LEVEL: opt("LOG_LEVEL", "info"),
    APP_TITLE: req("APP_TITLE"),
    APP_URL: opt("APP_URL"),
    DEBUG_ROUTES: bool("DEBUG_ROUTES", false),
    AUTO_CALL: opt("AUTO_CALL", "yes"),
  },

  /* ---------------- AI Runtime ---------------- */
  ai: {
    timeoutMs: num("AI_TIMEOUT", 60000),
    maxTokens: num("AI_MAX_TOKENS", 4096),
    temperature: num("AI_TEMPERATURE", 0.85),
    topP: num("AI_TOP_P", 0.9),
    retries: {
      max: num("AI_MAX_RETRIES", 5),
      baseMs: num("AI_RETRY_BASE_MS", 500),
    },
    openrouter: {
      baseUrl: req("OPENROUTER_API_BASE"),
      providers: {
        anthropic: {
          model: opt("OPENROUTER_ANTHROPIC"),
          key: opt("OPENROUTER_API_KEY_ANTHROPIC"),
        },
        chatgpt: {
          model: opt("OPENROUTER_CHATGPT"),
          key: opt("OPENROUTER_API_KEY_CHATGPT"),
        },
        google: {
          model: opt("OPENROUTER_GOOGLE"),
          key: opt("OPENROUTER_API_KEY_GOOGLE"),
        },
        deepseek: {
          model: opt("OPENROUTER_DEEPSEEK"),
          key: opt("OPENROUTER_API_KEY_DEEPSEEK"),
        },
        meta: {
          model: opt("OPENROUTER_META"),
          key: opt("OPENROUTER_API_KEY_META"),
        },
      },
    },
  },

  /* ---------------- RSS / Feeds ---------------- */
  rss: {
    feedUrl: req("FEED_URL"),
    cutoffHours: num("FEED_CUTOFF_HOURS", 48),
    freshnessHours: num("FEED_FRESHNESS_HOURS", 24),
    retentionDays: num("FEED_RETENTION_DAYS", 60),
    minSourceChars: num("RSS_MIN_SOURCE_CHARS", 220),
    topicGuard: {
      minShared: num("RSS_TOPIC_GUARD_MIN_SHARED", 2),
      minOverlap: num("RSS_TOPIC_GUARD_MIN_OVERLAP", 0.12),
    },
    title: opt("RSS_FEED_TITLE"),
    description: opt("RSS_FEED_DESCRIPTION"),
  },

  /* ---------------- Podcast ---------------- */
  podcast: {
    title: req("PODCAST_TITLE"),
    author: req("PODCAST_AUTHOR"),
    description: req("PODCAST_DESCRIPTION"),
    link: req("PODCAST_LINK"),
    language: opt("PODCAST_LANGUAGE", "en-uk"),
    explicit: bool("PODCAST_EXPLICIT", false),
    categories: [
      opt("PODCAST_CATEGORY_1"),
      opt("PODCAST_CATEGORY_2"),
    ].filter(Boolean),
    copyright: opt("PODCAST_COPYRIGHT"),
    imageUrl: opt("PODCAST_IMAGE_URL"),
    owner: {
      name: opt("PODCAST_OWNER_NAME"),
      email: opt("PODCAST_OWNER_EMAIL"),
    },
    rss: {
      enabled: opt("PODCAST_RSS_ENABLED", "yes"),
      episodeMode: opt("PODCAST_RSS_EP", "Yes"),
    },
    funding: {
      text: opt("funding_text"),
      url: opt("funding_url"),
    },
    itunes: {
      keywords: opt("itunes_keywords"),
      type: opt("itunes_type"),
    },
    media: {
      introUrl: opt("PODCAST_INTRO_URL"),
      outroUrl: opt("PODCAST_OUTRO_URL"),
      ffmpegTimeoutMs: num("PODCAST_FFMPEG_TIMEOUT_MS", 900000),
    },
    index: {
      apiKey: opt("API_KEY_PODCAST_INDEX"),
      apiSecret: opt("API_SECRET_PODCAST_INDEX"),
      userAgent: opt("PODCASTINDEX_USER_AGENT"),
    },
  },

  /* ---------------- TTS ---------------- */
  tts: {
    voiceId: opt("POLLY_VOICE_ID", "Brian"),
    concurrency: num("TTS_CONCURRENCY", 3),
    chunking: {
      maxChars: num("MAX_POLLY_NATURAL_CHUNK_CHARS", 2800),
      minSummary: num("MIN_SUMMARY_CHARS", 900),
      maxSummary: num("MAX_SUMMARY_CHARS", 2400),
    },
    retries: {
      max: num("MAX_CHUNK_RETRIES", 5),
      delayMs: num("RETRY_DELAY_MS"),
      backoffMultiplier: num("RETRY_BACKOFF_MULTIPLIER"),
    },
  },

  /* ---------------- R2 ---------------- */
  r2: {
    endpoint: opt("R2_ENDPOINT"),
    region: opt("R2_REGION", "auto"),
    credentials: {
      accessKeyId: opt("R2_ACCESS_KEY_ID"),
      secretAccessKey: opt("R2_SECRET_ACCESS_KEY"),
    },
    buckets: {
      podcast: opt("R2_BUCKET_PODCAST"),
      rawText: opt("R2_BUCKET_RAW_TEXT"),
      chunks: opt("R2_BUCKET_CHUNKS"),
      meta: opt("R2_BUCKET_META"),
      merged: opt("R2_BUCKET_MERGED"),
      edited: opt("R2_BUCKET_EDITED_AUDIO"),
      transcripts: opt("R2_BUCKET_TRANSCRIPTS"),
      rss: opt("R2_BUCKET_RSS_FEEDS"),
      art: opt("R2_BUCKET_ART"),
    },
    publicBase: {
      podcast: opt("R2_PUBLIC_BASE_URL_PODCAST"),
      rawText: opt("R2_PUBLIC_BASE_URL_RAW_TEXT"),
      meta: opt("R2_PUBLIC_BASE_URL_META"),
      merge: opt("R2_PUBLIC_BASE_URL_MERGE"),
      rss: opt("R2_PUBLIC_BASE_URL_RSS"),
      art: opt("R2_PUBLIC_BASE_URL_ART"),
      chunks: opt("R2_PUBLIC_BASE_URL_CHUNKS"),
      edited: opt("R2_PUBLIC_BASE_URL_EDITED_AUDIO"),
      transcript: opt("R2_PUBLIC_BASE_URL_TRANSCRIPT"),
    },
  },

  /* ---------------- Outreach (Parked) ---------------- */
  outreach: {
    apiKeys: {
      serp: opt("API_SERP_KEY"),
      hunter: opt("API_HUNTER_KEY"),
      apollo: opt("API_APOLLO_KEY"),
      prospeo: opt("API_PROSPEO_KEY"),
      urlscan: opt("API_URLSCAN_KEY"),
      openPageRank: opt("API_OPENPAGERANK_KEY"),
    },
  },
};

/* ============================================================
   Phase 2 Compatibility Aliases
   (REMOVE in Phase 4 once migrations are complete)
============================================================ */
ENV.R2_BUCKET_RAW_TEXT = ENV.r2.buckets.rawText;
ENV.R2_BUCKET_PODCAST  = ENV.r2.buckets.podcast;
ENV.R2_BUCKET_CHUNKS   = ENV.r2.buckets.chunks;
ENV.R2_BUCKET_META     = ENV.r2.buckets.meta;
ENV.R2_BUCKET_MERGED   = ENV.r2.buckets.merged;
ENV.R2_BUCKET_ART      = ENV.r2.buckets.art;

ENV.R2_PUBLIC_BASE_URL_PODCAST     = ENV.r2.publicBase.podcast;
ENV.R2_PUBLIC_BASE_URL_RAW_TEXT    = ENV.r2.publicBase.rawText;
ENV.R2_PUBLIC_BASE_URL_META        = ENV.r2.publicBase.meta;
ENV.R2_PUBLIC_BASE_URL_MERGE       = ENV.r2.publicBase.merge;
ENV.R2_PUBLIC_BASE_URL_ART         = ENV.r2.publicBase.art;
ENV.R2_PUBLIC_BASE_URL_CHUNKS      = ENV.r2.publicBase.chunks;
ENV.R2_PUBLIC_BASE_URL_EDITED_AUDIO= ENV.r2.publicBase.edited;
ENV.R2_PUBLIC_BASE_URL_TRANSCRIPT  = ENV.r2.publicBase.transcript;

/* ============================================================
   Phase 2 Backward Compatibility (Flat Snapshot)
============================================================ */
export const ENV_FLAT = Object.freeze({
  ...process.env,
});
