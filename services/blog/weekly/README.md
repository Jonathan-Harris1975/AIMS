# Weekly blog builder

## Status

**Implemented.** This page documents the weekly blog builder under `services/blog/weekly/`.

## Purpose

Builds a weekly AI briefing blog post from rewritten RSS evidence, applies local validation, requests artwork, publishes the post package to Cloudflare R2, rebuilds the weekly blog RSS feed and triggers the website rebuild hook.

For the wider blog service, see [Blog service](../README.md).

## Routes

Mounted through the parent blog service:

- `POST /blog/weekly/build`

## Main files

- `buildWeeklyBlogPost.js`

## Workflow

- Load rewritten RSS JSON from R2 alias `rss`.
- Build a date window from `weekId`, `days`, or the previous complete ISO week.
- Normalise source items inside that window.
- Generate the weekly blog package through the shared OpenRouter route key `blogWeekly`.
- Run local brand validation and optional QA.
- Generate blog artwork or use the configured fallback image.
- Write post HTML, sidecar `post.json`, and the weekly posts manifest to R2 alias `blog` under `BLOG_PREFIX`.
- Publish the weekly blog RSS feed to R2 alias `blogRss`.
- Trigger the website rebuild hook.

## Environment variables

- `BLOG_PREFIX`
- `BLOG_RSS_OBJECT_KEY`
- `BLOG_RSS_FEED_URL`
- `BLOG_RSS_TITLE`
- `BLOG_RSS_DESCRIPTION`
- `BLOG_RSS_IMAGE_URL`
- `BLOG_WEEKLY_QA_ENABLED`
- `BLOG_FALLBACK_IMAGE_URL`
- `BLOG_ARTWORK_BUCKET_ALIAS`
- `SITE_BASE_URL`
- `WEBSITE_REBUILD_HOOK`
- `WEBSITE_REBUILD_HOOK_FALLBACK`
- R2 aliases: `rss`, `blog`, `blogImages`, `blogRss`
- OpenRouter route key: `blogWeekly`

## External integrations

- OpenRouter
- Cloudflare R2
- Website rebuild webhook
- Artwork service

## Storage

- Weekly manifest: `<BLOG_PREFIX>/posts.json`.
- Weekly post HTML: `<BLOG_PREFIX>/posts/<slug>/index.html`.
- Weekly sidecar JSON: `<BLOG_PREFIX>/posts/<slug>/post.json`.
- Weekly RSS XML: `BLOG_RSS_OBJECT_KEY` in R2 alias `blogRss`.

## Tests

- `test/blog-weekly-package.test.js`
- `test/blog-rss-feed.test.js`

## Common troubleshooting

- No items found: this is treated as a successful no-op to avoid noisy cron failures.
- Weak package output: inspect OpenRouter route configuration for `blogWeekly` and the source RSS payload.
- Artwork unavailable: configure `BLOG_FALLBACK_IMAGE_URL` or inspect artwork/OpenRouter image settings.
- Website did not update: check `WEBSITE_REBUILD_HOOK` and the website deployment logs.

## Connections to other services

Consumes RSS output from `services/rss-feed-creator/`, calls artwork helpers, uses shared OpenRouter/R2 utilities and triggers the external website rebuild.
