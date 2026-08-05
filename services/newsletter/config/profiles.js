// services/newsletter/config/profiles.js
//
// Newsletter profile registry. A "profile" is one editorial newsletter
// (source feeds, brand voice, Brevo list/sender, send schedule). AI Edge is
// the first profile; adding a second newsletter should mean adding a new
// profile entry here (or via env override), not touching engine code.
//
// Every value resolves from an environment variable first so profiles can be
// reconfigured per-deploy without a code change, matching the pattern used
// throughout AIMS (see config/thresholds.js).

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null || String(value).trim() === ""
    ? fallback
    : String(value).trim();
}

function envList(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------------------------------------
// AI Edge — the first newsletter profile
// ------------------------------------------------------------
const aiEdge = Object.freeze({
  id: "ai-edge",
  displayName: env("NEWSLETTER_AI_EDGE_NAME", "AI Edge"),
  description:
    "A digest of the AI stories that actually matter — curated, ranked and " +
    "summarised in Jonathan Harris's clear, practical, no-hype voice.",

  // Source RSS feeds this profile draws from. Defaults to the same curated
  // feed list already used by the RSS rewrite pipeline
  // (services/rss-feed-creator/data/feeds.txt) via feedListPath, but can be
  // overridden with an explicit comma-separated env list for a profile that
  // needs its own sources.
  feedListPath: env(
    "NEWSLETTER_AI_EDGE_FEED_LIST_PATH",
    "services/rss-feed-creator/data/feeds.txt"
  ),
  feedUrls: envList("NEWSLETTER_AI_EDGE_FEED_URLS", []),

  // Brevo delivery target. Production sending should use the exact existing,
  // populated list ID. Automatic folder/list creation is disabled by default
  // so a successful build cannot silently send to a new empty audience.
  brevo: Object.freeze({
    listId: Number(env("NEWSLETTER_AI_EDGE_BREVO_LIST_ID", "")) || null,
    listName: env("NEWSLETTER_AI_EDGE_BREVO_LIST_NAME", env("NEWSLETTER_AI_EDGE_NAME", "AI Edge")),
    folderName: env("NEWSLETTER_AI_EDGE_BREVO_FOLDER_NAME", env("NEWSLETTER_AI_EDGE_NAME", "AI Edge")),
    fromName: env("NEWSLETTER_AI_EDGE_FROM_NAME", "Jonathan Harris — AI Edge"),
    fromEmail: env("NEWSLETTER_AI_EDGE_FROM_EMAIL", env("BREVO_FROM_EMAIL")),
    replyTo: env("NEWSLETTER_AI_EDGE_REPLY_TO", env("NEWSLETTER_AI_EDGE_FROM_EMAIL", env("BREVO_FROM_EMAIL"))),
  }),

  // R2 storage layout — reuses the existing blog / blog-images buckets
  // rather than provisioning new infrastructure.
  storage: Object.freeze({
    htmlBucketKey: "blog",
    heroImageBucketKey: "blogImages",
    keyPrefix: env("NEWSLETTER_AI_EDGE_KEY_PREFIX", "newsletter/ai-edge"),
  }),

  // Editorial defaults (overridable per-profile without touching the engine).
  storyCount: Number(env("NEWSLETTER_AI_EDGE_STORY_COUNT", "")) || undefined,
  brandVoice: env(
    "NEWSLETTER_AI_EDGE_BRAND_VOICE",
    "Clear, practical AI coverage — minus the hype, buzzwords and magical thinking. " +
      "Gen X sensibility. British English throughout. No breathless hyperbole, no " +
      "'game-changing' or 'revolutionary' filler — just what happened and why it matters."
  ),

  // Thursday house promotion. Tuesday's featured book is resolved from the
  // canonical featured-book API at build time so it stays aligned with the
  // rest of the AIMS content ecosystem.
  podcastPromotion: Object.freeze({
    title: env("NEWSLETTER_AI_EDGE_PODCAST_TITLE", "Turing's Torch: AI Weekly"),
    url: env("NEWSLETTER_AI_EDGE_PODCAST_URL", "https://jonathan-harris.online/podcast/"),
    blurb: env("NEWSLETTER_AI_EDGE_PODCAST_BLURB", ""),
    imageUrl: env("NEWSLETTER_AI_EDGE_PODCAST_IMAGE_URL", ""),
    ctaLabel: env("NEWSLETTER_AI_EDGE_PODCAST_CTA_LABEL", "Follow Turing's Torch"),
  }),
});

const PROFILE_REGISTRY = Object.freeze({
  "ai-edge": aiEdge,
});

export function getNewsletterProfile(profileId = "ai-edge") {
  const id = String(profileId || "ai-edge").trim().toLowerCase();
  const profile = PROFILE_REGISTRY[id];
  if (!profile) {
    const valid = Object.keys(PROFILE_REGISTRY).join(", ");
    throw new Error(`Unknown newsletter profile '${profileId}'. Valid profiles: ${valid}`);
  }
  return profile;
}

export function listNewsletterProfiles() {
  return Object.values(PROFILE_REGISTRY);
}

export default { getNewsletterProfile, listNewsletterProfiles };
