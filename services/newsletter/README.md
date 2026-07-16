# Newsletter Engine (`services/newsletter`)

Config-driven, multi-profile daily/weekly newsletter engine. Ships with one
profile — **AI Edge** — a daily AI-news digest in Jonathan Harris's brand
voice. A second newsletter should mean a new entry in
`services/newsletter/config/profiles.js`, not new engine code.

Independent of HIVE at runtime: nothing in this directory calls out to HIVE
or its skill registry. See `config/skills/S094-newsletter-composer.local.json`
for how this relates to HIVE's centrally-owned skill index.

Triggering and scheduling are entirely out of scope here — MAST (a separate
repository) calls the HTTP endpoints below exactly when an issue should be
built and, later, sent; the engine has no internal clock or scheduledAt.

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
        -> [later, on MAST's signal] Brevo: create campaign + sendNow
```

## HTTP endpoints (mounted at `/newsletter`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/newsletter/generate` | Build one issue. Body: `{ profileId?, sessionId? }`. Runs async (returns a job) when called via the async-job convention already used elsewhere in AIMS; otherwise runs synchronously and returns the full result. |
| GET | `/newsletter/jobs/:lane/:sessionId` | Poll an async generate job. |
| POST | `/newsletter/send` | Deliver a previously-built, QA-passed issue via Brevo — creates the campaign and sends it immediately. Body: `{ profileId?, sessionId, date? }`. |
| GET | `/newsletter/campaigns/:campaignId/status` | Poll Brevo for a real campaign's status/performance. |

Monthly audit (mirrors the existing `*-council` audit pattern, feeds RAMS):

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/audits/newsletter/run` | Compute the newsletter section of the monthly audit and publish it to the R2 audits bucket. |
| GET | `/audits/newsletter/health` | Status/health check. |
| GET | `/audits/newsletter/jobs/:sessionId` | Poll an async audit job. |

## Delivery: Brevo

The engine uses [Brevo's v3 API](https://developers.brevo.com/reference/quickstart-reference)
(`api-key` header auth, `BREVO_API_KEY`). Unlike the EmailOctopus integration
this replaced, Brevo documents full campaign creation and immediate sending,
so `POST /newsletter/send` is a straightforward flow:

1. **Sender check** — Brevo requires a sender to complete one-time OTP
   verification (emailed to that address) before it can send. AIMS creates
   the sender via the API on first use, but **cannot complete OTP
   verification itself** (that requires reading an inbox). Until that's
   done, `/newsletter/send` returns `status: "sender_pending_validation"`
   (HTTP 409) with the sender ID and a clear next step, rather than
   attempting a send that would fail.
2. **List check** — AIMS owns list creation. `ensureList()`
   (`brevo/audience.js`) looks up the profile's configured list name and
   creates it (in a matching folder) on first run; no pre-existing list ID
   is required. Safe to call on every send — idempotent by name.
3. **Create + send** — `POST /emailCampaigns` with the issue's subject and
   `htmlUrl` (pointing at the already-public R2 copy, avoiding Brevo's 1MB
   inline-content ceiling), targeted at the resolved list, then
   `POST /emailCampaigns/{id}/sendNow`. No `scheduledAt` is ever set —
   MAST decides *when* by deciding *when it calls this endpoint*.
4. **Delivery record** — on success, `{campaignId, listId, sentAt}` is
   written to `campaign.json` alongside the issue's `metadata.json` in R2,
   so the monthly audit can pull real open/click/unsubscribe stats per
   issue via `GET /emailCampaigns/{id}?statistics=globalStats`.

## Configuration

All engine-wide behaviour (QA threshold, rewrite ceiling, RSS window, Brevo
retry/timeout) lives in `config/thresholds.js` under `THRESHOLDS.newsletter`,
resolved from environment variables — see `env.template` for the full list.
Per-profile settings (feeds, brand voice, Brevo list/folder/sender name,
featured-content CTA) live in `services/newsletter/config/profiles.js`.

## Adding a second newsletter profile

1. Add an entry to the `PROFILE_REGISTRY` in `config/profiles.js` (copy the
   `aiEdge` shape, including its own `brevo.listName` / `brevo.fromEmail`).
2. Add its env vars to `env.template`.
3. Verify its sender's OTP in Brevo once (see above).
4. Nothing else changes — `buildNewsletter({ profileId })` and the routes
   already take `profileId` as a parameter.
