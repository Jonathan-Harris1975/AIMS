// ============================================================
// ⚙️ Central production thresholds
// ============================================================
//
// Single source of truth for tunable numeric/boolean thresholds that were
// previously hard-coded (or scattered across individual `process.env.X`
// reads) throughout the scheduler, validators and podcast pipeline.
//
// Every value here still resolves from an environment variable so existing
// deployments keep working with zero config changes (backwards compatible
// defaults match the previous hard-coded behaviour unless a specific
// production-hardening fix required a new default — those are called out
// below and documented in docs/production-hardening.md).
//
// Extension point: add new thresholds here rather than inlining
// `Number(process.env.X || fallback)` in feature code, so every knob is
// discoverable and documented in one place.
// ============================================================

function num(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

export const THRESHOLDS = Object.freeze({
  // Cross-cutting floor: every retry/attempt knob in this file defaults to
  // at least this many total attempts before a pipeline is allowed to
  // quarantine an artefact or fail a QA gate. Individual knobs below may be
  // raised above this floor for slower/flakier upstreams, but must not be
  // set below it without an explicit, documented reason.
  minRetryAttemptsFloor: Math.max(1, num("MIN_RETRY_ATTEMPTS_FLOOR", 5)),
  reviewCouncil: Object.freeze({
    // Number of repair -> revalidate cycles the review council runs against
    // a failing artefact before it is quarantined. Applies to every caller
    // of runReviewCouncilGate() (RSS rewrite, blog phase4/5, Blotato script
    // quality, Zernio social posts).
    maxAttempts: Math.max(1, num("REVIEW_COUNCIL_MAX_ATTEMPTS", 5)),
  }),
  scheduler: Object.freeze({
    // Window in hours within which identical content (by content hash) posted
    // to more than one account/category is treated as an accidental duplicate.
    // OB-001 / BSC-OB-002.
    dedupeWindowHours: num("ZERNIO_CROSSPOST_DEDUPE_HOURS", 48),
    // Number of Zernio queue pages scanned when checking for duplicates.
    queueGuardLookbackPages: Math.max(1, num("ZERNIO_QUEUE_GUARD_LOOKBACK_PAGES", 2)),
  }),
  validators: Object.freeze({
    // Anti-hype validator: fraction of generated samples allowed to contain a
    // flagged generic-abstraction phrase before the pipeline should be
    // treated as regressing. BSC-OB-003 verification target: <3%. Enforced
    // as a rolling daily batch check in antiHypeBatchTracker.js, which emits
    // a QA event when the day's flagged share exceeds this value.
    antiHypeMaxFlaggedShare: num("VALIDATOR_ANTI_HYPE_MAX_FLAGGED_SHARE", 0.03),
    // Entity validator: below this word count, a summary with too few named
    // entities should trigger a regeneration pass. OB-003 / BSC-OB-004.
    entityMinWordsForCheck: Math.max(1, num("VALIDATOR_ENTITY_MIN_WORDS_FOR_CHECK", 40)),
    // Minimum distinct named entities a qualifying summary must retain.
    entityMinCount: Math.max(0, num("VALIDATOR_ENTITY_MIN_COUNT", 1)),
    // Podcast/RSS discovery metadata: maximum curated keyword terms.
    // OB-005 / BSC-OB-006 asks for 4-6; default trimmed from the previous
    // hard-coded 12 down to 6.
    metadataMaxKeywords: Math.max(1, num("VALIDATOR_METADATA_MAX_KEYWORDS", 6)),
    // Spoken-cadence validator: informational clauses longer than this many
    // words should be flagged for a pause/break. OB-006.
    spokenMaxClauseWords: Math.max(4, num("VALIDATOR_SPOKEN_MAX_CLAUSE_WORDS", 22)),
    // Spoken-cadence validator: number of consecutive list-style items before
    // requiring a worked example between them.
    spokenMaxBareListItems: Math.max(1, num("VALIDATOR_SPOKEN_MAX_BARE_LIST_ITEMS", 2)),
  }),
  podcastArtwork: Object.freeze({
    // Number of full-prompt generation attempts before falling back to a
    // trimmed prompt retry. OB-004 / BSC-OB-005. The actual per-provider
    // attempt count is read from ARTWORK_PROVIDER_ATTEMPTS by
    // getArtworkProviderAttempts() in openrouterImagePayload.js — keep that
    // default/cap in sync with this value.
    retryCount: Math.max(1, num("PODCAST_ARTWORK_RETRY_COUNT", 5)),
    // Whether a shortened prompt retry pass should run after the normal
    // provider attempts are exhausted, before using branded fallback art.
    shortPromptRetryEnabled: bool("PODCAST_ARTWORK_SHORT_PROMPT_RETRY", true),
  }),
  logging: Object.freeze({
    // Whether validators/scheduler emit structured QA optimisation events
    // (in addition to normal info/warn logs).
    qaEventsEnabled: bool("QA_EVENTS_ENABLED", true),
    // Optional webhook to receive high-severity QA alerts (e.g. repeated
    // artwork generation failures). Empty disables webhook delivery; the
    // structured log event is always emitted regardless.
    alertWebhookUrl: String(process.env.QA_ALERT_WEBHOOK_URL || "").trim(),
  }),
  // Newsletter engine (services/newsletter) — AI Edge and future profiles.
  // Single source of truth for the editorial QA review loop, story
  // selection, RSS ingestion window and Brevo delivery behaviour.
  newsletter: Object.freeze({
    // Rolling ingestion window: only articles published within this many
    // hours of "now" are eligible for selection. Spec: previous 24 hours.
    rssWindowHours: Math.max(1, num("NEWSLETTER_RSS_WINDOW_HOURS", 24)),
    // Number of curated stories in the daily digest (excludes the lead).
    storyCount: Math.max(1, num("NEWSLETTER_STORY_COUNT", 10)),
    // QA review loop: minimum composite score (0-100) required to publish.
    qaPassThreshold: Math.max(0, Math.min(100, num("NEWSLETTER_QA_PASS_THRESHOLD", 85))),
    // QA review loop: hard ceiling on rewrite iterations before quarantine.
    // Kept at/above THRESHOLDS.minRetryAttemptsFloor — a newsletter is only
    // quarantined after at least 5 compose->validate passes.
    maxRewriteIterations: Math.max(1, num("NEWSLETTER_MAX_REWRITE_ITERATIONS", 5)),
    // RSS retrieval retry/backoff for transient upstream feed failures.
    // rss.js treats this as additional retries after the first attempt, so
    // 4 here yields 5 total attempts.
    rssFetchRetries: Math.max(0, num("NEWSLETTER_RSS_FETCH_RETRIES", 4)),
    rssFetchRetryBaseMs: Math.max(100, num("NEWSLETTER_RSS_FETCH_RETRY_BASE_MS", 500)),
    rssFetchTimeoutMs: Math.max(1000, num("NEWSLETTER_RSS_FETCH_TIMEOUT_MS", 15000)),
    // Brevo API client retry/backoff. brevo/client.js treats this as
    // additional retries after the first attempt, so 4 here yields 5 total
    // attempts.
    brevoRetries: Math.max(0, num("BREVO_RETRIES", 4)),
    brevoRetryBaseMs: Math.max(100, num("BREVO_RETRY_BASE_MS", 500)),
    brevoTimeoutMs: Math.max(1000, num("BREVO_TIMEOUT_MS", 15000)),
  }),
});

export default THRESHOLDS;
