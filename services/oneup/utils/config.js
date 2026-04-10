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

export const DEFAULT_TIMEZONE = trimString(process.env.ONEUP_TIMEZONE, "Europe/London");
export const ONEUP_API_BASE = trimString(process.env.ONEUP_API_BASE, "https://www.oneupapp.io/api").replace(/\/+$/, "");
export const ONEUP_CATEGORY_NAME_GENERAL = trimString(process.env.ONEUP_CATEGORY_NAME_GENERAL, "General");
export const ONEUP_SOCIAL_NETWORK_ID = trimString(process.env.ONEUP_SOCIAL_NETWORK_ID, "ALL");
export const ONEUP_DEFAULT_DRY_RUN = ["1", "true", "yes", "on"].includes(
  trimString(process.env.ONEUP_DEFAULT_DRY_RUN, "false").toLowerCase()
);
export const ONEUP_RSS_LOOKBACK_DAYS = Number(process.env.ONEUP_RSS_LOOKBACK_DAYS || 7);
export const ONEUP_QUEUE_GUARD_LOOKBACK_PAGES = Math.max(1, Number(process.env.ONEUP_QUEUE_GUARD_LOOKBACK_PAGES || 2));

export const LANE_CONFIG = {
  monday: {
    key: "monday",
    label: "Monday Motivation",
    promptTheme: "Monday Motivation",
    publishTime: normaliseTime(process.env.ONEUP_MONDAY_TIME, "14:00"),
    imageUrl: trimString(process.env.ONEUP_MONDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Monday`),
    hashtags: ["#MondayMotivation", "#AIInspiration", "#TechLeadership"],
  },
  tuesday: {
    key: "tuesday",
    label: "Tuesday Tech Talk",
    promptTheme: "Tuesday Tech Talk",
    publishTime: normaliseTime(process.env.ONEUP_TUESDAY_TIME, "13:00"),
    imageUrl: trimString(process.env.ONEUP_TUESDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Tuesday`),
    hashtags: ["#TechTalkTuesday", "#AIExplained", "#MachineLearning"],
  },
  wednesday: {
    key: "wednesday",
    label: "Wednesday Writer's Corner",
    promptTheme: "Wednesday Writer's Corner",
    publishTime: normaliseTime(process.env.ONEUP_WEDNESDAY_TIME, "12:20"),
    imageUrl: trimString(process.env.ONEUP_WEDNESDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Wednesday`),
    hashtags: ["#WritersWednesday", "#AIWriting", "#ContentCreation"],
  },
  thursday: {
    key: "thursday",
    label: "Thursday Industry AI",
    promptTheme: "Thursday Industry AI",
    publishTime: normaliseTime(process.env.ONEUP_THURSDAY_TIME, "12:20"),
    imageUrl: trimString(process.env.ONEUP_THURSDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Thursday`),
    hashtags: ["#TechThursday", "#Industry40", "#DigitalTransformation"],
  },
  friday: {
    key: "friday",
    label: "Friday Build In Public",
    promptTheme: "Friday Build In Public",
    publishTime: normaliseTime(process.env.ONEUP_FRIDAY_TIME, "11:20"),
    imageUrl: trimString(process.env.ONEUP_FRIDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Friday`),
    hashtags: ["#BackendDev", "#AIDevelopment", "#BuildInPublic", "#BehindTheScenes"],
  },
  saturday: {
    key: "saturday",
    label: "Saturday AI Ethics",
    promptTheme: "Saturday AI Ethics",
    publishTime: normaliseTime(process.env.ONEUP_SATURDAY_TIME, "10:30"),
    imageUrl: trimString(process.env.ONEUP_SATURDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Saturday`),
    hashtags: ["#AIEthics", "#ResponsibleAI", "#TechPolicy"],
  },
  sunday: {
    key: "sunday",
    label: "Sunday AI Spotlight",
    promptTheme: "Sunday AI Spotlight",
    publishTime: normaliseTime(process.env.ONEUP_SUNDAY_TIME, "18:00"),
    imageUrl: trimString(process.env.ONEUP_SUNDAY_IMAGE_URL, `${DAILY_IMAGE_BASE}/Sunday`),
    hashtags: ["#AISpotlight", "#AIPioneers", "#AIHistory"],
  },
};

export const QUIZ_CONFIG = {
  key: "quiz",
  questionPublishTime: normaliseTime(process.env.ONEUP_QUIZ_QUESTION_TIME, "12:00"),
  answerPublishTime: normaliseTime(process.env.ONEUP_QUIZ_ANSWER_TIME, "12:00"),
  questionImageUrl: trimString(process.env.ONEUP_QUIZ_IMAGE_URL, `${DAILY_IMAGE_BASE}/Quiz`),
  answerImageUrl: trimString(process.env.ONEUP_QUIZ_ANSWER_IMAGE_URL, `${DAILY_IMAGE_BASE}/Answer`),
  questionHashtags: ["#AIQuiz", "#MachineLearning", "#TechTrivia"],
  answerHashtags: ["#AIQuiz", "#AIInsights", "#MachineLearning"],
};
