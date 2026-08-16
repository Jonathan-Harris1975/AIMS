# Outreach service

**Live route prefix:** `/outreach`

Discovers and qualifies backlink/outreach prospects using search and enrichment providers, validates candidate email/domain data, scores leads and stores accepted batches in the Comms Hub R2 bucket. Google Sheets is no longer an outreach persistence target.

## HTTP contract

- `GET /outreach/health`
- `POST /outreach/keyword` — run discovery for a supplied keyword/topic.
- `POST /outreach/batch/next` — advance the configured batch workflow. For the temporary Make.com test window only, this exact POST route may bypass suite bearer auth when `OUTREACH_BATCH_NEXT_ALLOW_PUBLIC=true`.
- `POST /outreach/batch/reset` — reset durable batch progress.

## Behaviour

Provider integrations include SERP discovery, Hunter and ZeroBounce-style validation, URL/domain reputation signals and Cloudflare R2 output. Accepted lead batches are stored through the shared `commsHub` R2 alias under `outreach/leads/YYYY-MM-DD/...`.

Production acceptance is intentionally quality-weighted for backlink prospecting:

- `OUTREACH_MIN_AUTHORITY_SCORE=14`
- `OUTREACH_MIN_LEAD_SCORE=18`
- `OUTREACH_MIN_EMAIL_SCORE=0.5`

Testing has a completely separate switch and lower thresholds so a dry validation run can yield enough data without weakening production policy:

- `OUTREACH_TEST_MODE=false` by default
- `OUTREACH_TEST_MIN_AUTHORITY_SCORE=8`
- `OUTREACH_TEST_MIN_LEAD_SCORE=10`
- `OUTREACH_TEST_MIN_EMAIL_SCORE=0.2`

Never leave `OUTREACH_TEST_MODE=true` after the controlled test window.

## AI/model policy

The outreach discovery/qualification path does not call an LLM. It is deterministic provider data plus scoring, so adding a paid model here would add cost and variability without improving the current task. If Comms Hub later drafts or analyses an outreach conversation, it uses the Comms Hub free-first ZDR model chain; paid models remain reserved for complex chat only.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, and the outreach config module as configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public contract. During the temporary Outreach test window, only `POST /outreach/batch/next` is exempt when `OUTREACH_BATCH_NEXT_ALLOW_PUBLIC=true`; `GET` on that path, `/outreach/keyword`, `/outreach/batch/reset`, and every other protected AIMS route still require bearer auth.
- `AIMS_OPERATION_OUTREACH_ENABLED=false` remains unchanged, so AIMS' own weekday operations scheduler does not also trigger Outreach while Make.com is providing the twice-daily test cadence.
- Set `OUTREACH_BATCH_NEXT_ALLOW_PUBLIC=false` as soon as the Make.com test window ends.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Durable artefacts and job state use configured R2/state utilities rather than process memory where durable storage is required.
