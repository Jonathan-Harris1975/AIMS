# Blog service

## Status

**Implemented.** This page documents behaviour backed by files in `services/blog/`.

## Purpose

Publishes weekly AI briefing posts and daily/social blog posts from rewritten RSS evidence, maintains manifests, publishes RSS feeds and triggers website rebuild hooks.

## Routes

- `POST /blog/weekly/build`
- `POST /blog/rss/rebuild`
- `POST /blog/social/daily/build`
- `POST /blog/social/rss/rebuild`

## Main files

- `weekly/buildWeeklyBlogPost.js`
- `social/buildDailySocialBlogPost.js`
- `rss/publishBlogRssFeed.js`
- `social/publishSocialBlogRssFeed.js`
- `utils/weeklyPackage.js`, `utils/socialBlogPackage.js`, `utils/templates.js`

## Workflow

- Load rewritten RSS JSON from R2 alias `rss`.
- Filter items by requested window.
- Generate structured package through OpenRouter.
- Run local brand validation and optional QA.
- Generate artwork, use configured fallback art, or continue publishing without blocking if artwork is unavailable.
- Write HTML, sidecar JSON and manifest to R2 alias `blog`.
- Publish RSS to R2 alias `blogRss`.
- Trigger website rebuild hook.

## Environment variables

- `BLOG_PREFIX`, `BLOG_RSS_OBJECT_KEY`, `BLOG_RSS_FEED_URL`, `BLOG_RSS_TITLE`, `BLOG_RSS_DESCRIPTION`, `BLOG_RSS_IMAGE_URL`
- `BLOG_SOCIAL_PREFIX`, `BLOG_SOCIAL_RSS_OBJECT_KEY`, `BLOG_SOCIAL_RSS_TITLE`, `BLOG_SOCIAL_RSS_DESCRIPTION`, `BLOG_SOCIAL_FALLBACK_IMAGE_URL`, `BLOG_SOCIAL_QA_ENABLED`
- `BLOG_SOCIAL_PUBLIC_BASE_URL`, `BLOG_SOCIAL_PUBLIC_POSTS_BASE_URL`
- `BLOG_WEEKLY_QA_ENABLED`, `BLOG_FALLBACK_IMAGE_URL`, `BLOG_ARTWORK_BUCKET_ALIAS`
- `SITE_BASE_URL`, `WEBSITE_REBUILD_HOOK`, `WEBSITE_REBUILD_HOOK_FALLBACK`
- R2 aliases: `rss`, `blog`, `blogImages`, `blogRss`
- OpenRouter route keys: `blogWeekly`, `blogSocial`

## External integrations

- OpenRouter
- Cloudflare R2
- Website rebuild webhook
- Artwork service

## Storage

- Weekly manifest: `<BLOG_PREFIX>/posts.json`.
- Weekly posts: `<BLOG_PREFIX>/posts/<slug>/index.html` and `post.json`.
- Social manifest: `<BLOG_SOCIAL_PREFIX>/posts.json`.
- Social posts: `<BLOG_SOCIAL_PREFIX>/posts/<slug>/index.html` and `post.json`.
- RSS XML: `BLOG_RSS_OBJECT_KEY` and `BLOG_SOCIAL_RSS_OBJECT_KEY` in R2 alias `blogRss`.

## Tests

- `test/blog-rss-feed.test.js`
- `test/blog-social-package.test.js`
- `test/blog-social-rss-feed.test.js`
- `test/blog-social-schema.test.js`
- `test/blog-weekly-package.test.js`

## Common troubleshooting

- No items found: this is treated as a successful no-op (`ok:true`, `skipped:true`) to avoid noisy cron failures; verify `feed.json` if content was expected.
- Artwork failure: configure fallback image URL or fix OpenRouter image configuration.
- Post skipped: existing social post for date; pass `force=true` to rebuild.
- Rebuild hook failure: check hook env and endpoint status.

## Connections to other services

Consumes RSS output from rss-feed-creator, calls artwork helpers, uses shared AI/R2 utilities and triggers external website rebuild.
