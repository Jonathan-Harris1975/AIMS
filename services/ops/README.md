> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Operational preflight service

## Status

**Implemented.** This page documents behaviour backed by files in `services/ops/`.

## Purpose

Provides lightweight scheduler-facing checks before timed AIMS jobs run. These endpoints confirm that the AIMS process is alive, that the scheduler supplied target context, and that obvious service-specific environment hints are present.

The service is intentionally small. It does not run the heavy job, call external publishing APIs, mutate R2, or spend OpenRouter credits.

## Routes

- `GET /ops/health`
- `GET /ops/preflight`
- `GET /ops/warmup`

## Main files

- `index.js`

## Workflow

- Read scheduler context from query string or trigger headers.
- Identify the target service using `service` query value, defaulting to `suite`.
- Check basic process readiness.
- Check that `targetPath` was supplied by the scheduler.
- Check selected service environment hints where configured.
- Return warning-only readiness by default.
- Return HTTP `503` for missing required hints only when `AIMS_OPS_PREFLIGHT_STRICT=true`.

## Environment variables

- `AIMS_OPS_PREFLIGHT_STRICT`
- Service hints currently checked by code:
  - `ZERNIO_META_API_KEY`
  - `BLOTATO_API_KEY`
  - `R2_BUCKET_AUDITS`
  - `R2_PUBLIC_BASE_URL_AUDITS`
  - `R2_BUCKET_PODCAST`
  - `R2_BUCKET_RAW_TEXT`
  - `R2_BUCKET_BLOG`

## External integrations

None. This service performs local process/env checks only.

## Storage

No storage.

## Tests

Covered indirectly by route-registry and smoke/startup checks.

## Common troubleshooting

- `ready-with-warnings`: the service is responding, but scheduler context or one of the configured env hints is missing.
- `503` from preflight/warmup: strict mode is enabled and at least one configured check failed.
- Missing target path: confirm the scheduler is passing `targetPath` or `x-trigger-source-path`.

## Connections to other services

Used by external schedulers such as MAST before running heavier AIMS routes. It should remain low-cost and side-effect free.
