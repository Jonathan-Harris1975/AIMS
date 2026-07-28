# AIMS services

This directory contains the production service modules mounted by `routes/index.js` plus internal support modules used by those services.

## Mounted services

| Directory | Route prefix | Live responsibility |
|---|---|---|
| `artwork` | `/artwork` | Generate artwork for podcast, blog and direct requests |
| `blog` | `/blog` | Weekly blog, blog social and blog RSS |
| `blotato` | `/blotato` | Short-form video generation and publishing |
| `cloudflare-purge` | `/cloudflare` | Cache purge and site-shell sync |
| `newsletter` | `/newsletter` | AI Edge generation and Brevo delivery |
| `ops` | `/ops` | Weekday operation windows and readiness checks |
| `outreach` | `/outreach` | Discovery, enrichment, validation and lead batching |
| `podcast` | `/podcast` | End-to-end podcast pipeline |
| `rss-feed-creator` | `/rss` | RSS rewrite and publication pipeline |
| `rss-links` | `/rss-links` | Short links and redirects |
| `script` | `/script` | Podcast script and transcript generation |
| `tts` | `/tts` | Speech and final audio processing |
| `zernio` | `/zernio` | Social scheduling and promotional lanes |

## Internal support modules

- `content-quality` — shared validators and editorial quality gates.
- `shared` — authentication, state, R2, AI, dedupe, operational and request utilities.
- `social` — shared social helpers used by publishing services.
- `rss-feed-podcast` — podcast RSS generation support used by the podcast workflow.
- `api` — internal router composition module; the production route registry mounts the service routers directly.

## Service design contract

Each live service is responsible for its own request validation, domain logic, external provider calls and lane-specific QA. Shared concerns such as auth, storage, model access, retries, content governance and durable state should use `services/shared` rather than duplicate implementations.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
