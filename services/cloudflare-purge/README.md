# Cloudflare purge service

## Status

**Implemented.** This page documents behaviour backed by files in `services/cloudflare-purge/`.

## Purpose

Provides an HTTP wrapper around Cloudflare zone cache purge with request-body validation. The purge endpoint intentionally accepts bearer-authenticated, legacy-secret, and unauthenticated webhook callers.

## Routes

- `GET /cloudflare/health`
- `POST /cloudflare/purge`

## Main files

- `routes/index.js`
- `utils/purgeCloudflareCache.js`

## Workflow

- Health route reports whether zone/token env is configured.
- Purge route is public at the AIMS suite-auth layer so Cloudflare/worker webhooks can call it without Hookdeck bearer injection.
- If `Authorization: Bearer <AIMS_API_KEY>` or legacy `x-cloudflare-purge-secret` is present and valid, the route records the auth strategy for diagnostics, but missing auth is not rejected.
- Request body must contain exactly one purge mode.
- Utility calls Cloudflare v4 purge endpoint and normalises errors.

## Environment variables

- `CF_zone`
- `CF_purge`
- `CLOUDFLARE_PURGE_SHARED_SECRET` optional legacy diagnostic marker; no longer required for `/cloudflare/purge`
- `CLOUDFLARE_PURGE_TIMEOUT_MS`
- `CF_EMAIL` appears in template but is not used by current bearer-token purge implementation.

## External integrations

Cloudflare API.

## Storage

No repository storage is used.

## Tests

No dedicated Cloudflare purge test was found.

## Common troubleshooting

- 401/403 from AIMS should not occur for `/cloudflare/purge`; the route is intentionally open to authenticated and unauthenticated webhook callers.
- 401/403 from Cloudflare itself means the outbound `CF_purge` token or zone cache-purge permission is wrong.
- 500 missing config: set `CF_zone` and `CF_purge`.
- 400 validation: supply exactly one purge mode.
- 502/4xx from Cloudflare: check token permissions and zone ID.

## Connections to other services

Independent service. Uses shared HTTP client and shared request schema.
