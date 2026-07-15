# Zernio Social Scheduler

Replaces the former OneUp integration (`services/oneup`, removed) as the
sole social scheduling provider. Built against the documented Zernio REST
API at https://docs.zernio.com/.

## Configuration

All configuration is read from environment variables (see `.env.example`
and `env.template` for the full, current list). Key variables:

| Variable | Purpose |
| --- | --- |
| `ZERNIO_META_API_KEY` | Bearer token for all Zernio API calls (posting *and* analytics — shared with `audits/utils/zernioSocialPerformance.js`). |
| `ZERNIO_API_BASE_URL` | Defaults to `https://zernio.com/api/v1`. |
| `ZERNIO_PROFILE_NAME_GENERAL` / `ZERNIO_PROFILE_NAME_EBOOKS` | Zernio "profile" names (equivalent to OneUp's "categories"). Both default to `Default`, since the connected Zernio account currently routes all posts through a single "Default" profile. Set them to different values if the account is later split into separate profiles. |
| `ZERNIO_ACCOUNT_ID` | A single Zernio account id, `ALL`, or a JSON/CSV list of ids. |
| `ZERNIO_REQUIRED_PLATFORMS` | Lowercase, comma-separated Zernio platform values (e.g. `facebook,instagram,tiktok`) that must be covered before a lane is allowed to post live. |
| `ZERNIO_VALIDATE_TARGET_ACCOUNTS` | When `true`, checks the resolved profile/account targeting against Zernio before every live post. |
| `ZERNIO_DEFAULT_DRY_RUN` | Falls back to dry-run behaviour when no API key is configured. |
| `ZERNIO_CROSSPOST_DEDUPE_HOURS`, `ZERNIO_QUEUE_GUARD_LOOKBACK_PAGES` | See `config/thresholds.js`. |

## Routes

Mounted at `/zernio` (see `../../routes/index.js`):

- `GET /zernio/health`
- `POST /zernio/setup/check` — validates profile/account/platform targeting without posting.
- `POST /zernio/posts/history` — historic published-post scan via the Zernio analytics endpoint.
- `POST /zernio/daily/:laneKey` — one route per day-of-week lane in `LANE_CONFIG`.
- `POST /zernio/blog-rss/daily` — reposts the newest unused item from the blog service's public social RSS feed (see below).
- `POST /zernio/ebooks/weekly`
- `POST /zernio/quiz/weekly`
- `GET /zernio/jobs/:lane/:sessionId` — async job status (Hookdeck-backed routes).

## Known limitations vs the former OneUp integration

Zernio's documented public API does not expose everything OneUp did. Where
no documented Zernio equivalent exists, the code says so explicitly in a
`LIMITATION` comment and falls back to the safest available alternative
rather than inventing an endpoint or field:

- **No per-post title / first-comment fields.** OneUp's schedule endpoints
  accepted a separate `title` and `first_comment`. Zernio's documented
  `POST /v1/posts` body has neither. The title is folded into the post
  content; the first comment is dropped with a warning rather than guessed
  at an undocumented field name.
- **No per-post profile/category name in the posts listing.** OneUp's
  `getscheduledposts`/`getpublishedposts` returned `category_name` per row.
  Zernio's `GET /v1/analytics` listing (the closest documented equivalent)
  only exposes `content`, `status`, `scheduledFor`/`publishedAt`, and
  per-platform `accountId`/`platform` rows. The duplicate-post guard
  (`getQueuedPosts` / `hasLikelyDuplicate` in `utils/socialScheduler.js`)
  matches on `accountId` + content hash + time window instead of profile
  name. The local slot-claim ledger in `utils/state.js` — which never
  depends on the Zernio API — remains the primary, always-available
  duplicate guard.
- **No dedicated "list scheduled posts" endpoint** is documented separately
  from the analytics endpoint, so both the queue-duplication guard and the
  historic published-post scan (`fetchPublishedPostsHistory`) go through
  `GET /v1/analytics`.
- **No native RSS import.** Zernio has no way to pull content from an RSS
  feed on its own, so the blog daily-briefing repost lane (below) fetches
  and parses the feed on the AIMS side instead.

## Blog daily briefing repost (`/zernio/blog-rss/daily`)

Zernio doesn't support posting directly from an RSS feed, so this lane
fetches the blog service's own public "social media blog" RSS feed —
`https://blog-rss.jonathan-harris.online/social-media-blog/feed.xml` (or
`ZERNIO_BLOG_RSS_FEED_URL`) — over plain HTTP, picks the newest item not
already posted (tracked via `hasRecentSocialSource`/`recordUsedSocialSource`
in `utils/state.js`), and schedules it to Zernio using the item's own
title, social caption, link, and image. This is read-only against the blog
service: `services/blog` (and its RSS/R2 internals) are never imported,
called, or modified by this lane — only the public feed URL is fetched.

Unlike the other daily lanes, this content is not AI-generated — the blog
service already writes each feed item's caption for social use — so this
lane skips prompt generation and the review-council gate and posts the feed
item close to verbatim (with hashtags derived from the feed's `<category>`
tags and the article link appended).

## Files

- `utils/zernioClient.js` — REST client for the documented Zernio endpoints (profiles, accounts, posts, analytics).
- `utils/config.js` — env-driven configuration and lane schedule.
- `utils/socialScheduler.js` — content generation + Zernio scheduling for daily lanes, the weekly quiz, the weekly ebook promo, and the blog RSS repost.
- `utils/blogRssFeed.js` — fetches and parses the blog service's public social RSS feed over HTTP.
- `utils/state.js` — local slot-claim ledger (duplicate/idempotency guard independent of the Zernio API).
- `utils/prompts.js`, `utils/date.js`, `utils/feedContext.js`, `utils/ebookCatalogue.js`, `utils/featuredBook.js` — supporting utilities, migrated unchanged in behaviour from the former `services/oneup`.
- `routes/social.js`, `routes/index.js`, `index.js` — Express routes.
