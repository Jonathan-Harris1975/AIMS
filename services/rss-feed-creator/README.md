> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# RSS feed creator

## Status

**Implemented.** This page documents behaviour backed by files in `services/rss-feed-creator/`.

## Purpose

Fetches configured feed sources, rewrites eligible items through OpenRouter, applies brand/topic guardrails and publishes newsletter RSS/XML plus JSON to R2.

## Routes

- `GET /rss` from root `routes/rss.js` reads published XML.
- `POST /rss` runs rebuild.
- `POST /rss/rewrite` runs rebuild through the service rewrite router.

## Main files

- `rewrite-pipeline.js`
- `utils/fetchFeeds.js`
- `utils/models.js`
- `utils/feedGenerator.js`
- `utils/feedRotationManager.js`
- `utils/rss-prompts.js`
- `data/feeds.txt`, `data/urls.txt`

## Workflow

- Load source lists from R2 or local files.
- Rotate feed sources.
- Fetch and parse RSS/Atom and URL sources.
- Filter future/old/duplicate/empty items.
- Rewrite using OpenRouter route `rssRewrite`.
- Run source-length and topic guard checks.
- Create short links where rewrite code calls rss-links service.
- Merge with existing feed and publish `feed.xml` and `feed.json`.

## Environment variables

- `RSS_OBJECT_KEY`, `RSS_FEED_TITLE`, `RSS_FEED_DESCRIPTION`, `FEED_URL`
- `FEED_CUTOFF_HOURS`, `FEED_RETENTION_DAYS`, `MAX_RSS_FEEDS_PER_RUN`, `MAX_URL_FEEDS_PER_RUN`, `MAX_ITEMS_PER_FEED`, `FEED_FETCH_CONCURRENCY`, `RSS_EMPTY_BATCH_ADVANCE_ATTEMPTS`, `RSS_REWRITE_BATCH_ADVANCE_ATTEMPTS`, `RSS_QUARANTINE_FALLBACK_THRESHOLD`, `RSS_REWRITE_MIN_PUBLISHABLE_ITEMS`
- `RSS_MIN_SOURCE_CHARS`, `RSS_TOPIC_GUARD_MIN_SHARED`, `RSS_TOPIC_GUARD_MIN_OVERLAP`, `MIN_SUMMARY_CHARS`, `MAX_SUMMARY_CHARS`
- R2 alias `rss` env: `R2_BUCKET_RSS_FEEDS`, `R2_PUBLIC_BASE_URL_RSS`
- OpenRouter route keys `rssRewrite`, `rssShortTitle`

## External integrations

- OpenRouter
- Cloudflare R2
- rss-parser
- RSS links service

## Storage

- Published XML: R2 alias `rss`, key `feed.xml` unless `RSS_OBJECT_KEY` differs for read route.
- Published JSON: R2 alias `rss`, key `feed.json`.
- Rotation/source list data under `data/*` keys when R2 source files are used.

## Tests

- `test/feed-fetching.test.js`
- `test/rss-feed-creator-brand.test.js`

## Common troubleshooting

- No items: check source list files, cutoff hours and fetch limits.
- Weak rewrites rejected: inspect topic guard and minimum source length.
- R2 publish failure: check `R2_BUCKET_RSS_FEEDS` and public URL.
- OpenRouter failure: inspect route provider diagnostics.

## Connections to other services

Feeds blog publishing, OneUp RSS context and RSS short-link creation.


## Empty-batch rotation

When a selected feed batch produces no fresh items within the configured cutoff window, the rewrite fetcher can advance to the next rotation batch within the same run. `RSS_EMPTY_BATCH_ADVANCE_ATTEMPTS` controls how many empty source batches it will try before returning an empty result.

## Quarantine fallback rotation

Phase 3 still fails closed per item: quarantined rewrites are never published. If more than `RSS_QUARANTINE_FALLBACK_THRESHOLD` item is quarantined in a rewrite batch, `rewrite-pipeline.js` automatically advances to the next available feed rotation batch up to `RSS_REWRITE_BATCH_ADVANCE_ATTEMPTS`. Safe rewritten items can still be published after fallback exhaustion as long as at least `RSS_REWRITE_MIN_PUBLISHABLE_ITEMS` passed all gates.

## Shared tone control

RSS rewriting, validation repair, short-title generation and the final relevance classifier now use the shared AIMS tone governor in `services/script/utils/toneSetter.js`. The RSS lane keeps the common Jonathan Harris voice while retaining its own concise feed-specific format rules.
