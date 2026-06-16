> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# RSS links service

## Status

**Implemented.** This page documents behaviour backed by files in `services/rss-links/`.

## Purpose

Creates and serves self-hosted short links backed by R2 objects in the newsletter RSS bucket.

## Routes

- `POST /rss-links/shorten`
- `GET /rss-links/:key`
- `GET /rss-links/:key/index.html`

## Main files

- `service.js`
- `store.js`
- `routes/shorten.js`
- `routes/redirect.js`
- `utils/randomString.js`, `utils/sha512.js`, `utils/checkURL.js`

## Workflow

- Validate original URL as absolute HTTP/HTTPS.
- Hash URL with SHA-512.
- Return existing record for the same URL hash.
- Generate unique short key for new URLs.
- Write record, URL index and static redirect page to R2.
- Redirect route reads record and sends HTTP 302 to original URL.

## Environment variables

- Current code uses R2 alias `rss`: `R2_BUCKET_RSS_FEEDS`, `R2_PUBLIC_BASE_URL_RSS`.
- `RSS_LINKS_BASE_URL`, `RSS_LINKS_PATH_PREFIX` and `RSS_LINKS_UNIQUE` exist in env.template but are not read by current code.

## External integrations

Cloudflare R2.

## Storage

- Record: `rss-links/_records/<key>.json`.
- URL index: `rss-links/_index/by-url/<sha512>.json`.
- Redirect page: `rss-links/<key>/index.html`.

## Tests

No dedicated RSS links test was found.

## Common troubleshooting

- 400 invalid URL: provide absolute `http` or `https` URL.
- 404 redirect: record missing or invalid key.
- Short URL domain wrong: current code uses `R2_PUBLIC_BASE_URL_RSS`, not `RSS_LINKS_BASE_URL`.

## Connections to other services

RSS feed creator can call `createShortLink` during rewrite output generation.
