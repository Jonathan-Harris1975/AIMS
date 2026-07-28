# RSS feed creator

**Live route prefix:** `/rss`

Fetches source feeds, filters unsuitable items, rewrites selected material into AIMS editorial summaries, validates source fidelity and publishes the generated feed.

## HTTP contract

The active rewrite endpoint is `POST /rss/rewrite`, with async job status available at `GET /rss/jobs/:lane/:sessionId`. The top-level `/rss` router also exposes the primary RSS acquisition/publication routes from `routes/rss.js`.

## Behaviour

The rewrite pipeline uses source-length/topic-overlap guards, bounded feed rotation, retry/backoff, quarantine thresholds and a minimum publishable-item requirement. Safe items can continue when individual items fail, but quarantined content is never published. Configure with `FEED_*`, `MAX_*FEEDS_PER_RUN`, summary-length controls, RSS rewrite thresholds and the RSS-related R2 buckets.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
