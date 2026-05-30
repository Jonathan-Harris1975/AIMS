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

export function normaliseOneUpSocialNetworkId(value, fallback = "ALL") {
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

export function parseNetworkTypes(value = "") {
  return parseCsv(value)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function boolFromEnv(value, fallback = false) {
  const cleaned = trimString(value, fallback ? "true" : "false").toLowerCase();
  return ["1", "true", "yes", "on"].includes(cleaned);
}

export const DEFAULT_TIMEZONE = trimString(process.env.ONEUP_TIMEZONE, "Europe/London");
export const ONEUP_API_BASE = trimString(process.env.ONEUP_API_BASE, "https://www.oneupapp.io/api").replace(/\/+$/, "");
export const ONEUP_CATEGORY_NAME_GENERAL = trimString(process.env.ONEUP_CATEGORY_NAME_GENERAL, "General");
export const ONEUP_CATEGORY_NAME_EBOOKS = trimString(process.env.ONEUP_CATEGORY_NAME_EBOOKS, "Ebooks");
export function getOneUpSocialNetworkId() {
  return normaliseOneUpSocialNetworkId(process.env.ONEUP_SOCIAL_NETWORK_ID, "ALL");
}

export function getOneUpRequiredNetworkTypes() {
  return parseNetworkTypes(process.env.ONEUP_REQUIRED_NETWORK_TYPES || "Facebook,Instagram,TikTok");
}

export function shouldValidateOneUpTargetAccounts() {
  return boolFromEnv(process.env.ONEUP_VALIDATE_TARGET_ACCOUNTS, true);
}

export const ONEUP_SOCIAL_NETWORK_ID = getOneUpSocialNetworkId();
export const ONEUP_REQUIRED_NETWORK_TYPES = getOneUpRequiredNetworkTypes();
export const ONEUP_VALIDATE_TARGET_ACCOUNTS = shouldValidateOneUpTargetAccounts();
export const ONEUP_DEFAULT_DRY_RUN = boolFromEnv(process.env.ONEUP_DEFAULT_DRY_RUN, false);
export const ONEUP_RSS_LOOKBACK_DAYS = Number(process.env.ONEUP_RSS_LOOKBACK_DAYS || 7);
export const ONEUP_QUEUE_GUARD_LOOKBACK_PAGES = Math.max(1, Number(process.env.ONEUP_QUEUE_GUARD_LOOKBACK_PAGES || 2));

export const LANE_CONFIG = {
  monday: {
    key: "monday",
    label: "Monday Motivation",
    promptTheme: "Monday Motivation",
    publishTime: normaliseTime(process.env.ONEUP_MONDAY_TIME, "14:00"),
    imageUrl: trimString(process.env.ONEUP_MONDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Monday`),
    hashtags: ["#ArtificialIntelligence", "#PracticalAI", "#AIForWork"],
    audienceIntent: "operator-discipline",
  },
  tuesday: {
    key: "tuesday",
    label: "Tuesday Tech Talk",
    promptTheme: "Tuesday Tech Talk",
    publishTime: normaliseTime(process.env.ONEUP_TUESDAY_TIME, "13:00"),
    imageUrl: trimString(process.env.ONEUP_TUESDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Tuesday`),
    hashtags: ["#AIExplained", "#ArtificialIntelligence", "#PracticalAI"],
    audienceIntent: "plain-english-ai-literacy",
  },
  wednesday: {
    key: "wednesday",
    label: "Wednesday Writer's Corner",
    promptTheme: "Wednesday Writer's Corner",
    publishTime: normaliseTime(process.env.ONEUP_WEDNESDAY_TIME, "12:20"),
    imageUrl: trimString(process.env.ONEUP_WEDNESDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Wednesday`),
    hashtags: ["#AIForWriters", "#PracticalAI", "#ArtificialIntelligence"],
    audienceIntent: "creator-workflow-help",
  },
  thursday: {
    key: "thursday",
    label: "Thursday Industry AI",
    promptTheme: "Thursday Industry AI",
    publishTime: normaliseTime(process.env.ONEUP_THURSDAY_TIME, "12:20"),
    imageUrl: trimString(process.env.ONEUP_THURSDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Thursday`),
    hashtags: ["#AIForWork", "#PracticalAI", "#ArtificialIntelligence"],
    audienceIntent: "industry-practical-use",
  },
  friday: {
    key: "friday",
    label: "Friday Build In Public",
    promptTheme: "Friday Build In Public",
    publishTime: normaliseTime(process.env.ONEUP_FRIDAY_TIME, "11:20"),
    imageUrl: trimString(process.env.ONEUP_FRIDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Friday`),
    hashtags: ["#BuildInPublic", "#PracticalAI", "#AIAutomation"],
    audienceIntent: "build-in-public-operator-note",
  },
  saturday: {
    key: "saturday",
    label: "Saturday AI Ethics",
    promptTheme: "Saturday AI Ethics",
    publishTime: normaliseTime(process.env.ONEUP_SATURDAY_TIME, "10:30"),
    imageUrl: trimString(process.env.ONEUP_SATURDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Saturday`),
    hashtags: ["#AIEthics", "#ResponsibleAI", "#ArtificialIntelligence"],
    audienceIntent: "ai-ethics-discussion",
  },
  sunday: {
    key: "sunday",
    label: "Sunday AI Spotlight",
    promptTheme: "Sunday AI Spotlight",
    publishTime: normaliseTime(process.env.ONEUP_SUNDAY_TIME, "18:00"),
    imageUrl: trimString(process.env.ONEUP_SUNDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Sunday`),
    hashtags: ["#AIHistory", "#ArtificialIntelligence", "#AIExplained"],
    audienceIntent: "ai-person-spotlight",
  },
};

export const QUIZ_CONFIG = {
  key: "quiz",
  questionPublishTime: normaliseTime(process.env.ONEUP_QUIZ_QUESTION_TIME, "12:00"),
  answerPublishTime: normaliseTime(process.env.ONEUP_QUIZ_ANSWER_TIME, "12:00"),
  questionImageUrl: trimString(process.env.ONEUP_QUIZ_IMAGE_URL, `${DAILY_IMAGE_BASE}/Quiz`),
  answerImageUrl: trimString(process.env.ONEUP_QUIZ_ANSWER_IMAGE_URL, `${DAILY_IMAGE_BASE}/Answer`),
  questionHashtags: ["#AIQuiz", "#AIExplained", "#ArtificialIntelligence"],
  audienceIntent: "ai-literacy-quiz",
  answerHashtags: ["#AIQuiz", "#AIExplained", "#ArtificialIntelligence"],
};


export const EBOOK_CONFIG = {
  key: "ebooks-weekly",
  weekdays: ["tuesday", "thursday", "saturday"],
  tuesdayPublishTime: normaliseTime(process.env.ONEUP_EBOOK_TUESDAY_TIME, "16:00"),
  thursdayPublishTime: normaliseTime(process.env.ONEUP_EBOOK_THURSDAY_TIME, "15:30"),
  saturdayPublishTime: normaliseTime(process.env.ONEUP_EBOOK_SATURDAY_TIME, "14:30"),
  hashtags: ["#ArtificialIntelligence", "#AIBooks", "#AIExplained"],
  audienceIntent: "ebook-conversion",
};

export const EBOOK_WEEKLY_CONFIG = EBOOK_CONFIG;
