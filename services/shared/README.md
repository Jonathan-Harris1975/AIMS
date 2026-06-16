> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Shared utilities

## Status

**Implemented.** This page documents behaviour backed by files in `services/shared/`.

## Purpose

Provides common infrastructure used by nearly every service: OpenRouter routing, R2 storage, durable state, job store, Hookdeck dedupe, rate limiting, schemas, HTTP helpers, HIVE shared skill-pool metadata access and cleanup utilities.

## Routes

No direct Express route is mounted from `services/shared`. It is imported by services and server middleware.

## Main files

- `middleware/rateLimit.js`
- `utils/ai-config.js`
- `utils/ai-service.js`
- `utils/r2-client.js`
- `hiveSkillPool.js` and `utils/hiveSkillPool.js`
- `utils/stateFile.js`
- `utils/jobStore.js`
- `utils/hookdeckDedupe.js`
- `utils/requestSchemas.js`
- `utils/podcastIndexClient.js`
- `utils/sessionId.js`
- `utils/keepalive.js`
- `http-client.js`

## Workflow

- Rate limit requests.
- Route OpenRouter calls to configured provider chains.
- Read/write/list/delete Cloudflare R2 objects through aliases.
- Resolve central HIVE/R2 shared skill-pool URLs and repo manifest metadata without keeping local skill descriptors in AIMS.
- Persist state locally or in R2 metasystem.
- Track async job lifecycle.
- Deduplicate Hookdeck events.
- Validate common request bodies with Zod.
- Notify PodcastIndex.

## Environment variables

- Core app vars: `NODE_ENV`, `APP_URL`, rate limit/body/timeouts/state vars
- R2 credentials and all `R2_BUCKET_*` / `R2_PUBLIC_BASE_URL_*` vars
- HIVE skill-pool vars: `R2_PUBLIC_BASE_URL_HIVE_SKILLS`, `R2_BUCKET_HIVE_SKILLS`, `HIVE_SKILLS_AIMS_MANIFEST_PATH`
- OpenRouter vars and `AI_*` controls
- PodcastIndex vars for hub notification

## External integrations

- OpenRouter
- Cloudflare R2
- PodcastIndex
- Hookdeck event headers

## Storage

Durable state uses local files under `APP_STATE_DIR` or R2 alias `metasystem` under `STATE_REMOTE_PREFIX`. Production rejects local-only state unless `ALLOW_EPHEMERAL_STATE=true`.

## Tests

- `test/durable-state.test.js`
- `test/openrouter-service-routing.test.js`
- `test/ai-service-provider-diagnostics.test.js`
- `test/ai-service-audit-timeout.test.js`

## Common troubleshooting

- State backend failure: configure R2 metasystem or allow ephemeral state intentionally.
- R2 alias missing: set the bucket env for the alias shown in the error.
- HIVE skill descriptor lookup wrong: check the HIVE public base URL, AIMS manifest path and reference-prefix descriptor path under `skills/`.
- OpenRouter all providers failed: inspect provider diagnostics and model/key env.
- Dedupe not working: Hookdeck event ID header must be present.

## Connections to other services

All major services depend on shared utilities. Changes here should be treated as platform-level changes and tested broadly.
