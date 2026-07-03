# AIMS production hardening — audit follow-through

**Status:** Implemented, additive to existing architecture
**Last reviewed:** 3 July 2026

This document covers the production-hardening work carried out against the
future-facing recommendations from the OneUp scheduler, on-brand content,
and podcast-pipeline audits. Every change here is additive: existing
modules, request shapes and environment variables keep working unchanged
unless explicitly noted.

## 1. Central configuration (`config/thresholds.js`)

Previously hard-coded numeric thresholds now live in one documented module,
each still resolving from an environment variable so no deployment needs to
change env vars to keep its current behaviour:

| Threshold | Env var | Default | Used by |
|---|---|---:|---|
| Dedupe window (hours) | `ONEUP_CROSSPOST_DEDUPE_HOURS` | 48 | OneUp scheduler content-hash dedupe |
| Queue guard lookback pages | `ONEUP_QUEUE_GUARD_LOOKBACK_PAGES` | 2 | OneUp scheduler duplicate scan |
| Anti-hype max flagged share | `VALIDATOR_ANTI_HYPE_MAX_FLAGGED_SHARE` | 0.03 | Anti-hype validator (reporting target, not a hard gate) |
| Entity min words for check | `VALIDATOR_ENTITY_MIN_WORDS_FOR_CHECK` | 40 | Entity validator |
| Entity min count | `VALIDATOR_ENTITY_MIN_COUNT` | 1 | Entity validator |
| Metadata max keywords | `VALIDATOR_METADATA_MAX_KEYWORDS` | 6 (was hard-coded 12) | Podcast/RSS discovery metadata |
| Spoken max clause words | `VALIDATOR_SPOKEN_MAX_CLAUSE_WORDS` | 22 | Spoken cadence validator |
| Spoken max bare list items | `VALIDATOR_SPOKEN_MAX_BARE_LIST_ITEMS` | 2 | Spoken cadence validator |
| Podcast artwork retry count | `PODCAST_ARTWORK_RETRY_COUNT` | 2 | Podcast artwork pipeline (documents the existing `ARTWORK_PROVIDER_ATTEMPTS` knob) |
| Short-prompt retry enabled | `PODCAST_ARTWORK_SHORT_PROMPT_RETRY` | true | Podcast artwork pipeline |
| QA events enabled | `QA_EVENTS_ENABLED` | true | Structured QA logging |
| QA alert webhook | `QA_ALERT_WEBHOOK_URL` | (unset) | High-severity QA alert delivery |

**Only behaviour change from a default:** the podcast/RSS discovery metadata
`itunesKeywords` cap dropped from a hard-coded 12 to a configurable 6, per
the audit's "4-6 curated terms" recommendation. Set
`VALIDATOR_METADATA_MAX_KEYWORDS=12` to restore the previous cap if needed.

**Extension point:** add new thresholds to `config/thresholds.js` rather
than inlining `Number(process.env.X || fallback)` in feature code.

## 2. Structured QA event logging (`services/shared/utils/qaEvents.js`)

`emitQaEvent({ source, type, severity, message, detail, persist })` gives
every validator, the scheduler's dedupe path, and the podcast artwork
pipeline a consistent structured log envelope (`qa.event`) instead of ad hoc
free-text log lines. It:

- Logs through the existing `info`/`warn`/`error` logger at a severity-appropriate level.
- Optionally persists a JSON copy to the `audits` R2 bucket under
  `qa-events/{date}/{id}.json` when called with `persist: true` (used for
  podcast artwork failures) — best-effort, never throws.
- Optionally POSTs a webhook alert for `high`/`critical` severity events when
  `QA_ALERT_WEBHOOK_URL` is set.

**Extension point:** call `emitQaEvent()` from any new validator or pipeline
stage; no registration step needed.

## 3. Modular content-quality validators (`services/content-quality/validators/`)

Five independent, side-effect-light validators, each importable on its own
or via the barrel `services/content-quality/validators/index.js`:

- **`antiHypeValidator.js`** — flags the existing banned-promo/hedging
  phrase lists plus a new grouped generic-abstraction list ("landscape",
  "revolution", "paradigm", "game-changer", "transform", "unprecedented").
  Wired into the OneUp social gate (`runOneUpSocialGate`) and the RSS
  rewrite pipeline's banned-phrase retry.
- **`entityValidator.js`** — lightweight, dependency-free named-entity
  heuristic (`extractNamedEntities`) used to catch summaries that dropped
  every concrete organisation/person/technology from the source. Wired into
  `rewriteArticle()` in `services/rss-feed-creator/utils/models.js` as a
  one-shot regeneration retry, mirroring the existing banned-phrase retry
  pattern.
- **`metadataValidator.js`** — validates podcast `itunesKeywords`
  (duplicate terms, over-cap counts, repeated-across-episodes). Wired into
  `buildPodcastDiscoveryMetadata()`.
- **`spokenCadenceValidator.js`** — delegates long-sentence detection to
  the existing `findLongSpokenSentences` in `scriptValidation.js` (not
  reimplemented), and adds a new check for "list of three" enumerations with
  no worked example or `[pause]` cue between items. Wired into the podcast
  script orchestrator as a non-blocking warning.
- **`brandValidator.js`** — reusable wrapper around the existing brand
  lexicon checks (British spelling, banned promo patterns, motivational
  tone, engagement bait, hashtag rules) for any pipeline stage that isn't
  the OneUp gate.

**Extension point:** add a new validator file to this directory and
re-export it from `index.js`. Compose validators for a given call site with
`runValidators({ source, text, antiHype: {}, brand: {} })` rather than
importing every validator directly.

## 4. Scheduler improvements (`services/oneup/utils/socialScheduler.js`)

- **Content hash dedupe** — unchanged mechanism (`contentHash` + queue scan),
  now sourced from `config/thresholds.js` instead of an inline env read.
- **Configurable duplicate window** — `hasLikelyDuplicate()` accepts a
  per-call `windowHours` override; requests can pass `dedupeWindowHours` to
  `POST /oneup/daily/:laneKey`.
- **`allowDuplicate` override** — explicit, documented field
  (`post.allowDuplicate`, request body `allowDuplicate`). `crosspost` is
  kept as a backwards-compatible alias. Every duplicate check now emits a
  `scheduler.dedupe.*` QA event, whether blocked or allowed.
- **Automatic account-specific post variants** — new
  `buildAndScheduleDailyLaneAccountVariants(laneKey, options)`, used when a
  request supplies `categoryNames` (array of 2+ accounts) instead of a
  single `categoryName`. The canonical post is scheduled to the first
  account unchanged; each additional account gets a deterministic, lightly
  reworded variant (`buildAccountVariant()` in `prompts.js`) with
  `allowDuplicate: true`, since the cross-post is intentional and tracked.
  Existing single-account callers are unaffected.
- **QA event logging** — the OneUp gate (`runOneUpSocialGate`) now emits a
  `scheduler.gate.*` QA event whenever it finds defects, in addition to its
  existing return value.

## 5. Content generation

- **Anti-hype prompt improvements** — `buildDailyPrompt()` now explicitly
  instructs against the generic-abstraction word list and asks for the
  concrete effect (who/what/impact) instead, and to name a specific
  organisation/person/technology where the topic supports it.
- **RSS entity preservation** — see validator description above; the retry
  only replaces the summary if it measurably improves entity coverage,
  otherwise the original stands.
- **Account-specific prompt variation** — `buildAccountVariant()` in
  `services/oneup/utils/prompts.js` (deterministic, no extra LLM call).

## 6. Podcast pipeline

- **Artwork retry** — existing per-provider retry (`ARTWORK_PROVIDER_ATTEMPTS`)
  and multi-provider fallback (`getArtworkProviders()`) unchanged.
- **Prompt shortening** — new `buildShortInstruction()` in
  `services/artwork/utils/artwork.js`; after every provider fails with the
  full prompt, `generateArtworkBase64()` sweeps the providers once more with
  a trimmed prompt (`PODCAST_ARTWORK_SHORT_PROMPT_RETRY`, default on).
- **Provider fallback** — unchanged (primary/backup OpenRouter image
  models via `getArtworkProviders()`).
- **Deterministic branded fallback** — `PODCAST_FALLBACK_IMAGE_URLS`
  (comma-separated) rotates through a pool of pre-approved branded fallback
  images, selected deterministically by session ID, instead of always
  returning the same single static image. `PODCAST_FALLBACK_IMAGE_URL`
  (singular) still works as a one-item pool for backwards compatibility.
- **Failure alerts** — every exhausted artwork generation raises a
  `podcast.artwork` QA event at `high` severity with `persist: true`
  (written to the `audits` R2 bucket and, if `QA_ALERT_WEBHOOK_URL` is set,
  posted to that webhook).

## 7. Request schema additions (`services/shared/utils/requestSchemas.js`)

`oneupDailyBodySchema` gained, all optional and backwards compatible:

- `categoryNames` — string or array of 1-10 account/category names.
- `allowDuplicate` — explicit duplicate-window override.
- `dedupeWindowHours` — per-request duplicate window override (1-720).

`crosspost` remains accepted as an alias for `allowDuplicate`.

## Verifying locally

```bash
npm ci
npm test                 # full test suite, including test/content-quality-validators.test.js
node scripts/buildCheck.js   # or: npm run build
```

`test/content-quality-validators.test.js` covers all five validators in
isolation. No new external dependencies were introduced.
