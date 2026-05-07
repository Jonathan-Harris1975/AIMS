# Cloudflare purge service

## Status

**Implemented.** This page documents behaviour backed by files in `services/cloudflare-purge/`.

## Purpose

Provides an HTTP wrapper around Cloudflare zone cache purge with validation and optional application-level shared-secret protection.

## Routes

- `GET /cloudflare/health`
- `POST /cloudflare/purge`

## Main files

- `routes/index.js`
- `utils/purgeCloudflareCache.js`

## Workflow

- Health route reports whether zone/token env is configured.
- Purge route optionally checks `x-cloudflare-purge-secret`.
- Request body must contain exactly one purge mode.
- Utility calls Cloudflare v4 purge endpoint and normalises errors.

## Environment variables

- `CF_zone`
- `CF_purge`
- `CLOUDFLARE_PURGE_SHARED_SECRET`
- `CLOUDFLARE_PURGE_TIMEOUT_MS`
- `CF_EMAIL` appears in template but is not used by current bearer-token purge implementation.

## External integrations

Cloudflare API.

## Storage

No repository storage is used.

## Tests

No dedicated Cloudflare purge test was found.

## Common troubleshooting

- 401/403: missing or invalid `x-cloudflare-purge-secret`.
- 500 missing config: set `CF_zone` and `CF_purge`.
- 400 validation: supply exactly one purge mode.
- 502/4xx from Cloudflare: check token permissions and zone ID.

## Connections to other services

Independent service. Uses shared HTTP client and shared request schema.
