# Newsletter Engine (`services/newsletter`)

Config-driven, multi-profile daily/weekly newsletter engine. Ships with one
profile — **AI Edge** — a daily AI-news digest in Jonathan Harris's brand
voice. A second newsletter should mean a new entry in
`services/newsletter/config/profiles.js`, not new engine code.

Independent of HIVE at runtime: nothing in this directory calls out to HIVE
or its skill registry. See `config/skills/S094-newsletter-composer.local.json`
for how this relates to HIVE's centrally-owned skill index.

Triggering is out of scope here — MAST (a separate repository) is expected
to call the HTTP endpoints below on a schedule and poll for job completion,
the same pattern already used for the weekly blog build.

## Pipeline

```
RSS ingestion (24h window, dedupe, retry/backoff)
        -> ranking (recency + topical relevance + source diversity)
        -> composition (subject, preview, hero headline, lead article,
                         top-N story summaries, footer) — AI, structured JSON
        -> hero image (ONE per issue, never per-story)
        -> QA loop:
             deterministic validators (banned phrases, British spelling,
             structural completeness, duplicate/malformed links)
             + AI editorial review (factual grounding / tone / cohesion, 0-100)
             -> bounded rewrite (config/thresholds.js: maxRewriteIterations)
             -> quarantine if still failing after the last attempt
        -> render (email-safe table/inline-CSS HTML + plaintext fallback)
        -> store in R2 (reuses the existing `blog` / `blog-images` buckets)
```

## HTTP endpoints (mounted at `/newsletter`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/newsletter/generate` | Build one issue. Body: `{ profileId?, sessionId? }`. Runs async (returns a job) when the request looks like it came from the async-job caller convention already used elsewhere in AIMS; otherwise runs synchronously and returns the full result. |
| GET | `/newsletter/jobs/:lane/:sessionId` | Poll an async generate job. |
| POST | `/newsletter/send` | Deliver a previously-built, QA-passed issue. Body: `{ profileId?, sessionId, date?, scheduledFor? }`. |
| GET | `/newsletter/campaigns/:campaignId/status` | Poll EmailOctopus for a real campaign's status/report summary. |

Monthly audit (mirrors the existing `*-council` audit pattern, feeds RAMS):

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/audits/newsletter/run` | Compute the newsletter section of the monthly audit and publish it to the R2 audits bucket. |
| GET | `/audits/newsletter/health` | Status/health check. |
| GET | `/audits/newsletter/jobs/:sessionId` | Poll an async audit job. |

## EmailOctopus — a documented limitation, not a workaround

The [EmailOctopus v2 API](https://emailoctopus.com/api-documentation/v2)
(checked 2026-07-15) documents list/contact/tag/field management, automation
triggering, and read-only campaign/report endpoints — but **no
campaign-creation or campaign-scheduling endpoint**. `POST /send` therefore:

1. Tries a feature-flagged, defensive `attemptCreateCampaign()` call — off
   by default (`EMAILOCTOPUS_ATTEMPT_CAMPAIGN_CREATE=false`), so it never
   guesses at an endpoint shape that isn't documented.
2. Falls back to storing a complete, ready-to-send "campaign packet"
   (subject, preview text, HTML/text URLs, target list, intended send time)
   in R2, and returns `status: "pending_manual_send"`.
3. Optionally queues a pre-built EmailOctopus **Automation** (trigger:
   "Started via API" — fully documented) for a configured test/system
   contact, via `NEWSLETTER_AI_EDGE_AUTOMATION_ID`.

If EmailOctopus later documents campaign creation, flip the feature flag —
no code change needed. `services/newsletter/emailoctopus/client.js` only
implements endpoints that are actually documented today.

## Configuration

All engine-wide behaviour (QA threshold, rewrite ceiling, RSS window, send
time/timezone, EmailOctopus retry/timeout) lives in `config/thresholds.js`
under `THRESHOLDS.newsletter`, resolved from environment variables — see
`env.template` for the full list. Per-profile settings (feeds, brand voice,
EmailOctopus list, featured-content CTA) live in
`services/newsletter/config/profiles.js`.

## Adding a second newsletter profile

1. Add an entry to the `PROFILE_REGISTRY` in `config/profiles.js` (copy the
   `aiEdge` shape).
2. Add its env vars to `env.template`.
3. Nothing else changes — `buildNewsletter({ profileId })` and the routes
   already take `profileId` as a parameter.
