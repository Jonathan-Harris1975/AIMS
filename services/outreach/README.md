# Outreach service

**Live route prefix:** `/outreach`

Discovers and qualifies outreach prospects using search/enrichment providers, validates candidate email/domain data, scores leads and appends accepted records to the configured Google Sheet.

## HTTP contract

- `GET /outreach/health`
- `POST /outreach/keyword` — run discovery for a supplied keyword/topic.
- `POST /outreach/batch/next` — advance the configured batch workflow.
- `POST /outreach/batch/reset` — reset durable batch progress.

## Behaviour

Provider integrations include SERP discovery, Hunter/Prospeo/Apollo/ZeroBounce-style enrichment/validation as configured, URL/domain reputation signals and Google Sheets output. Acceptance is threshold-driven via `OUTREACH_MIN_LEAD_SCORE` and `OUTREACH_MIN_EMAIL_SCORE`. Batch cursor/progress uses shared durable state.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
