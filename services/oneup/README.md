# OneUp service

## Status

**Implemented.** This page documents behaviour backed by files in `services/oneup/`.

## Purpose

Generates and optionally schedules social content to OneUp: daily lane posts, weekly quiz posts, weekly ebook posts, and published-post history retrieval.

## Routes

- `GET /oneup/health`
- `POST /oneup/setup/check`
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
- Resolve category and validate the target accounts before scheduling.
- Schedule text or image post through OneUp unless dry-run applies.
- Record lane/quiz schedule state.

## Environment variables

- `ONEUP_API_KEY`, `ONEUP_API_BASE`, `ONEUP_TIMEZONE`
- `ONEUP_CATEGORY_NAME_GENERAL`, `ONEUP_CATEGORY_NAME_EBOOKS`
- `ONEUP_SOCIAL_NETWORK_ID`, `ONEUP_REQUIRED_NETWORK_TYPES`, `ONEUP_VALIDATE_TARGET_ACCOUNTS`, `ONEUP_DEFAULT_DRY_RUN`
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
- Run `POST /oneup/setup/check` to verify that the selected `General` and `Ebooks` categories actually include the required Facebook, Instagram, and TikTok targets before live scheduling.
- Missing API key can produce dry-run output.
- `ONEUP_SOCIAL_NETWORK_ID=ALL` targets every account in the selected category only. If Facebook, Instagram, or TikTok is missing from that category, the intended cross-platform OneUp coverage will not be created.
- A bare account ID such as `fb-page-123` is normalised to the OneUp-required JSON-array format `["fb-page-123"]`.
- Category/API errors are reported per post for the weekly ebook workflow so one failed day does not turn the whole route into a blunt 500. Check `failedDays` and each day’s `error` field.
- Duplicate guard may intentionally skip a scheduled post.
- Invalid model JSON is retried once with repair instructions.

## Connections to other services

Consumes RSS context from rss-feed-creator output and featured-book/sponsor data from script utilities. Uses shared AI and state utilities.


## OneUp API retry guard

Transient OneUp API failures are retried automatically for schedule/list calls. Configure with:

- `ONEUP_API_RETRY_ATTEMPTS` default `3`
- `ONEUP_API_RETRY_BASE_MS` default `800`
- `ONEUP_API_RETRY_MAX_MS` default `6000`

Only network errors, HTTP 408/425/429, and 5xx responses are retried. Auth, validation, duplicate and targeting failures still fail immediately.
