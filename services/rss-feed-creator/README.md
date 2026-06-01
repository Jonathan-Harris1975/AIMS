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
- `FEED_CUTOFF_HOURS`, `FEED_RETENTION_DAYS`, `MAX_RSS_FEEDS_PER_RUN`, `MAX_URL_FEEDS_PER_RUN`, `MAX_ITEMS_PER_FEED`, `FEED_FETCH_CONCURRENCY`, `RSS_EMPTY_BATCH_ADVANCE_ATTEMPTS`
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

When a selected feed batch produces no fresh items within the configured cutoff window, the rewrite fetcher can now advance to the next rotation batch within the same run. `RSS_EMPTY_BATCH_ADVANCE_ATTEMPTS` controls how many batches it will try before returning an empty result.
