# OneUp service

## Status

**Implemented.** This page documents behaviour backed by files in `services/oneup/`.

## Purpose

Generates and optionally schedules social content to OneUp: daily lane posts, weekly quiz posts, weekly ebook posts, and published-post history retrieval.

## Routes

- `GET /oneup/health`
- `POST /oneup/posts/history`
- `POST /oneup/daily/:laneKey` where lane is `monday` through `sunday`
- `POST /oneup/ebooks/weekly`
- `POST /oneup/quiz/weekly`

## Main files

- `routes/social.js`
- `utils/socialScheduler.js`
- `utils/oneupClient.js`
- `utils/config.js`
- `utils/prompts.js`
- `utils/ebookCatalogue.js`
- `data/ebooks.json`, `data/ebooks.xlsx`

## Workflow

- Resolve lane/date/time/category options.
- Generate structured JSON content through OpenRouter.
- Normalise content and hashtags.
- Fetch queued posts to prevent likely duplicates.
- Resolve category and schedule text or image post through OneUp unless dry-run applies.
- Record lane/quiz schedule state.

## Environment variables

- `ONEUP_API_KEY`, `ONEUP_API_BASE`, `ONEUP_TIMEZONE`
- `ONEUP_CATEGORY_NAME_GENERAL`, `ONEUP_CATEGORY_NAME_EBOOKS`
- `ONEUP_SOCIAL_NETWORK_ID`, `ONEUP_DEFAULT_DRY_RUN`
- `ONEUP_RSS_LOOKBACK_DAYS`, `ONEUP_QUEUE_GUARD_LOOKBACK_PAGES`
- Daily time vars `ONEUP_MONDAY_TIME` through `ONEUP_SUNDAY_TIME`
- Daily image override vars `ONEUP_MONDAY_IMAGE_URL` through `ONEUP_SUNDAY_IMAGE_URL`
- Quiz vars `ONEUP_QUIZ_*`
- Ebook vars `ONEUP_EBOOK_*`, `ONEUP_EBOOK_CATALOGUE_PATH`
- OpenRouter route keys `oneupDaily`, `oneupQuiz`, `oneupEbook`

## External integrations

- OneUp API
- OpenRouter
- RSS feed context
- Local ebook catalogue
- Shared durable state

## Storage

Scheduler state is handled by service utilities and shared state; no service-specific R2 bucket alias is defined here.

## Tests

`test/oneup-social.test.js`

## Common troubleshooting

- Live scheduling requires `ONEUP_API_KEY`.
- Missing API key can produce dry-run output.
- Category errors mean the configured category name does not exist in OneUp.
- Duplicate guard may intentionally skip a scheduled post.
- Invalid model JSON is retried once with repair instructions.

## Connections to other services

Consumes RSS context from rss-feed-creator output and featured-book/sponsor data from script utilities. Uses shared AI and state utilities.
