import { THRESHOLDS } from "../../../config/thresholds.js";

const DAILY_IMAGE_BASE = "https://images.jonathan-harris.online";

function trimString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const cleaned = String(value).trim();
  return cleaned || fallback;
}

function normaliseTime(value, fallback) {
  const cleaned = trimString(value, fallback);
  return /^\d{2}:\d{2}$/.test(cleaned) ? cleaned : fallback;
}

function parseCsv(value = "") {
  return String(value || "")
    .split(/[;,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

// Zernio "accounts" are addressed by accountId rather than OneUp's
// social_network_id, but the shape (a single id, "ALL", or a JSON/CSV list
// of ids) is unchanged so this keeps the same normalisation contract.
export function normaliseZernioAccountId(value, fallback = "ALL") {
  const cleaned = trimString(value, fallback);
  if (!cleaned || /^all$/i.test(cleaned)) return "ALL";

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const ids = parsed.map((item) => trimString(item)).filter(Boolean);
      return ids.length ? JSON.stringify([...new Set(ids)]) : "ALL";
    }
  } catch {}

  const ids = parseCsv(cleaned);
  return ids.length ? JSON.stringify([...new Set(ids)]) : "ALL";
}

export function parsePlatforms(value = "") {
  return parseCsv(value)
    .map((item) => item.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

function boolFromEnv(value, fallback = false) {
  const cleaned = trimString(value, fallback ? "true" : "false").toLowerCase();
  return ["1", "true", "yes", "on"].includes(cleaned);
}

export const DEFAULT_TIMEZONE = trimString(process.env.ZERNIO_TIMEZONE, "Europe/London");
export const ZERNIO_API_BASE_URL = trimString(process.env.ZERNIO_API_BASE_URL, "https://zernio.com/api/v1").replace(/\/+$/, "");
// All Zernio posts currently go through a single "Default" profile in the
// connected Zernio account (there is no separate ebooks profile). Both
// constants are kept distinct — rather than collapsed into one — so a
// future split back into separate profiles only requires an env var change.
export const ZERNIO_PROFILE_NAME_GENERAL = trimString(process.env.ZERNIO_PROFILE_NAME_GENERAL, "Default");
export const ZERNIO_PROFILE_NAME_EBOOKS = trimString(process.env.ZERNIO_PROFILE_NAME_EBOOKS, "Default");

export function getZernioAccountId() {
  return normaliseZernioAccountId(process.env.ZERNIO_ACCOUNT_ID, "ALL");
}

// Zernio platform values are lowercase (twitter, instagram, tiktok, ...),
// unlike OneUp's capitalised "Facebook,Instagram,TikTok" network type names.
export function getZernioRequiredPlatforms() {
  return parsePlatforms(process.env.ZERNIO_REQUIRED_PLATFORMS || "facebook,instagram");
}

export function shouldValidateZernioTargetAccounts() {
  return boolFromEnv(process.env.ZERNIO_VALIDATE_TARGET_ACCOUNTS, true);
}

export const ZERNIO_ACCOUNT_ID = getZernioAccountId();
export const ZERNIO_REQUIRED_PLATFORMS = getZernioRequiredPlatforms();
export const ZERNIO_VALIDATE_TARGET_ACCOUNTS = shouldValidateZernioTargetAccounts();
export const ZERNIO_DEFAULT_DRY_RUN = boolFromEnv(process.env.ZERNIO_DEFAULT_DRY_RUN, false);
export const ZERNIO_RSS_LOOKBACK_DAYS = Number(process.env.ZERNIO_RSS_LOOKBACK_DAYS || 7);
// Platform-safe ceiling for normal Zernio social copy. Editorial prompts target
// substantially less than this, so the limit prevents accidental essays without
// forcing good posts into artificially short summaries.
export const ZERNIO_POST_MAX_CHARACTERS = Math.max(1200, Math.min(2200, Number(process.env.ZERNIO_POST_MAX_CHARACTERS || 1800)));
// Sourced from config/thresholds.js so the scheduler, docs and this config
// module never disagree about the duplicate window. ZERNIO_CROSSPOST_DEDUPE_HOURS
// and ZERNIO_QUEUE_GUARD_LOOKBACK_PAGES remain the supported env var names.
export const ZERNIO_CROSSPOST_DEDUPE_HOURS = THRESHOLDS.scheduler.dedupeWindowHours;
export const ZERNIO_QUEUE_GUARD_LOOKBACK_PAGES = THRESHOLDS.scheduler.queueGuardLookbackPages;

// Zernio has no built-in RSS import, so the blog service's own public
// "social media blog" RSS feed is fetched over HTTP and reposted daily.
// This only ever reads that public URL — the blog service itself
// (services/blog) is never touched by this lane.
export const ZERNIO_BLOG_RSS_FEED_URL = trimString(
  process.env.ZERNIO_BLOG_RSS_FEED_URL,
  "https://blog-rss.jonathan-harris.online/social-media-blog/feed.xml"
);

export const BLOG_RSS_CONFIG = {
  key: "blog-rss",
  label: "Blog Daily Briefing Repost",
  publishTime: normaliseTime(process.env.ZERNIO_BLOG_RSS_TIME, "12:00"),
  // Live scheduling is fail-closed when the feed item has no verified image.
  // A generic static tile would hide an upstream content failure and can be
  // unrelated to the actual AI story, so there is deliberately no default.
  fallbackImageUrl: trimString(process.env.ZERNIO_BLOG_RSS_IMAGE_URL, ""),
  hashtagLimit: Math.max(0, Number(process.env.ZERNIO_BLOG_RSS_HASHTAG_LIMIT || 3)),
  audienceIntent: "blog-daily-briefing-repost",
};

export const LANE_CONFIG = {
  monday: {
    key: "monday",
    label: "Monday Motivation",
    promptTheme: "Monday Motivation",
    publishTime: normaliseTime(process.env.ZERNIO_MONDAY_TIME, "14:00"),
    imageUrl: trimString(process.env.ZERNIO_MONDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Monday`),
    hashtags: ["#ArtificialIntelligence", "#PracticalAI", "#AIForWork"],
    audienceIntent: "operator-discipline",
  },
  tuesday: {
    key: "tuesday",
    label: "Tuesday Tech Talk",
    promptTheme: "Tuesday Tech Talk",
    publishTime: normaliseTime(process.env.ZERNIO_TUESDAY_TIME, "13:00"),
    imageUrl: trimString(process.env.ZERNIO_TUESDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Tuesday`),
    hashtags: ["#AIExplained", "#ArtificialIntelligence", "#PracticalAI"],
    audienceIntent: "plain-english-ai-literacy",
  },
  wednesday: {
    key: "wednesday",
    label: "Wednesday Writer's Corner",
    promptTheme: "Wednesday Writer's Corner",
    publishTime: normaliseTime(process.env.ZERNIO_WEDNESDAY_TIME, "12:20"),
    imageUrl: trimString(process.env.ZERNIO_WEDNESDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Wednesday`),
    hashtags: ["#AIForWriters", "#PracticalAI", "#ArtificialIntelligence"],
    audienceIntent: "creator-workflow-help",
  },
  thursday: {
    key: "thursday",
    label: "Thursday Industry AI",
    promptTheme: "Thursday Industry AI",
    publishTime: normaliseTime(process.env.ZERNIO_THURSDAY_TIME, "12:20"),
    imageUrl: trimString(process.env.ZERNIO_THURSDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Thursday`),
    hashtags: ["#AIForWork", "#PracticalAI", "#ArtificialIntelligence"],
    audienceIntent: "industry-practical-use",
  },
  friday: {
    key: "friday",
    label: "Friday Operator Notes",
    promptTheme: "Friday Operator Notes",
    publishTime: normaliseTime(process.env.ZERNIO_FRIDAY_TIME, "11:20"),
    imageUrl: trimString(process.env.ZERNIO_FRIDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Friday`),
    hashtags: ["#AIOperations", "#PracticalAI", "#AIAutomation"],
    audienceIntent: "operator-note-ai-systems",
  },
  saturday: {
    key: "saturday",
    label: "Saturday AI Ethics",
    promptTheme: "Saturday AI Ethics",
    publishTime: normaliseTime(process.env.ZERNIO_SATURDAY_TIME, "10:30"),
    imageUrl: trimString(process.env.ZERNIO_SATURDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Saturday`),
    hashtags: ["#AIEthics", "#ResponsibleAI", "#ArtificialIntelligence"],
    audienceIntent: "ai-ethics-discussion",
  },
  sunday: {
    key: "sunday",
    label: "Sunday AI Spotlight",
    promptTheme: "Sunday AI Spotlight",
    publishTime: normaliseTime(process.env.ZERNIO_SUNDAY_TIME, "18:00"),
    imageUrl: trimString(process.env.ZERNIO_SUNDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Sunday`),
    hashtags: ["#AIHistory", "#ArtificialIntelligence", "#AIExplained"],
    audienceIntent: "ai-person-spotlight",
  },
};

export const QUIZ_CONFIG = {
  key: "quiz",
  questionPublishTime: normaliseTime(process.env.ZERNIO_QUIZ_QUESTION_TIME, "12:00"),
  answerPublishTime: normaliseTime(process.env.ZERNIO_QUIZ_ANSWER_TIME, "12:00"),
  questionImageUrl: trimString(process.env.ZERNIO_QUIZ_IMAGE_URL, `${DAILY_IMAGE_BASE}/Quiz`),
  answerImageUrl: trimString(process.env.ZERNIO_QUIZ_ANSWER_IMAGE_URL, `${DAILY_IMAGE_BASE}/Answer`),
  questionHashtags: ["#AIQuiz", "#AIExplained", "#ArtificialIntelligence"],
  audienceIntent: "ai-literacy-quiz",
  answerHashtags: ["#AIQuiz", "#AIExplained", "#ArtificialIntelligence"],
};



export const MINI_SERIES_CONFIG = {
  key: "weekly-mini-series",
  label: "Weekly Topical Mini-Series",
  audienceIntent: "topical-authority-mini-series",
  minPosts: Math.max(3, Number(process.env.ZERNIO_MINI_SERIES_MIN_POSTS || 3)),
  maxPosts: Math.min(6, Math.max(3, Number(process.env.ZERNIO_MINI_SERIES_MAX_POSTS || 6))),
  minimumSuitabilityScore: Math.max(0, Math.min(100, Number(process.env.ZERNIO_MINI_SERIES_MIN_SCORE || 78))),
  researchLookbackDays: Math.max(2, Number(process.env.ZERNIO_MINI_SERIES_LOOKBACK_DAYS || 7)),
  researchMaxItems: Math.max(4, Number(process.env.ZERNIO_MINI_SERIES_MAX_SOURCE_ITEMS || 12)),
  fallbackImageUrl: trimString(process.env.ZERNIO_MINI_SERIES_IMAGE_URL, ""),
  publishTimes: {
    tuesday: normaliseTime(process.env.ZERNIO_MINI_SERIES_TUESDAY_TIME, "19:30"),
    wednesday: normaliseTime(process.env.ZERNIO_MINI_SERIES_WEDNESDAY_TIME, "19:30"),
    thursday: normaliseTime(process.env.ZERNIO_MINI_SERIES_THURSDAY_TIME, "20:00"),
    friday: normaliseTime(process.env.ZERNIO_MINI_SERIES_FRIDAY_TIME, "19:30"),
    saturday: normaliseTime(process.env.ZERNIO_MINI_SERIES_SATURDAY_TIME, "19:30"),
    sunday: normaliseTime(process.env.ZERNIO_MINI_SERIES_SUNDAY_TIME, "19:30"),
  },
};

export const PODCAST_PROMO_CONFIG = {
  key: "podcast-thursday-promo",
  label: "Turing's Torch Thursday Preview",
  publishTime: normaliseTime(process.env.ZERNIO_PODCAST_PROMO_TIME, "18:30"),
  feedUrl: trimString(process.env.ZERNIO_PODCAST_RSS_FEED_URL || process.env.PODCAST_RSS_FEED_URL, "https://podcast-rss-feeds.jonathan-harris.online/turing-torch.xml"),
  spotifyUrl: trimString(process.env.ZERNIO_PODCAST_SPOTIFY_URL || process.env.PODCAST_SPOTIFY_URL, "https://open.spotify.com/show/4NluRPjuAIGK59vVf7GcoF"),
  fallbackImageUrl: trimString(process.env.ZERNIO_PODCAST_PROMO_IMAGE_URL, `${DAILY_IMAGE_BASE}/Podcast`),
  audienceIntent: "podcast-friday-preview",
  hashtags: ["#TuringsTorch", "#ArtificialIntelligence", "#AIPodcast"],
};

export const EBOOK_CONFIG = {
  key: "ebooks-weekly",
  weekdays: ["tuesday", "thursday", "saturday"],
  tuesdayPublishTime: normaliseTime(process.env.ZERNIO_EBOOK_TUESDAY_TIME, "16:00"),
  thursdayPublishTime: normaliseTime(process.env.ZERNIO_EBOOK_THURSDAY_TIME, "15:30"),
  saturdayPublishTime: normaliseTime(process.env.ZERNIO_EBOOK_SATURDAY_TIME, "14:30"),
  hashtags: ["#ArtificialIntelligence", "#AIBooks", "#AIExplained"],
  audienceIntent: "ebook-conversion",
};

export const EBOOK_WEEKLY_CONFIG = EBOOK_CONFIG;
