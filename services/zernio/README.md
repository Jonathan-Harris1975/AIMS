# Zernio social service

**Live route prefix:** `/zernio`

Zernio owns AIMS static/social scheduling: seven daily editorial lanes, blog-RSS social posts, the weekly mini-series, Thursday Turing's Torch promotion, eBook promotion and the weekly quiz pair.

## HTTP contract

- `GET /zernio/health`
- `GET /zernio/jobs/:lane/:sessionId`
- `POST /zernio/setup/check`
- `POST /zernio/posts/history`
- `POST /zernio/daily/monday`
- `POST /zernio/daily/tuesday`
- `POST /zernio/daily/wednesday`
- `POST /zernio/daily/thursday`
- `POST /zernio/daily/friday`
- `POST /zernio/daily/saturday`
- `POST /zernio/daily/sunday`
- `POST /zernio/blog-rss/daily`
- `POST /zernio/mini-series/weekly`
- `POST /zernio/podcast/thursday-promo`
- `POST /zernio/ebooks/weekly`
- `POST /zernio/quiz/weekly`

## Publishing rules

- Daily lanes use deterministic day-specific intent and topic contracts.
- RSS-backed posts preserve supplied source URLs and must remain topically aligned with their evidence.
- British English, Jonathan Harris voice, semantic gates and review councils run before scheduling.
- Artwork is checked for relevance and visual defects before the external side effect. Hard pixel defects remain blocking. If both image providers miss only advisory score targets, the best relevant, text-safe generated candidate is used instead of a static lane image.
- Curated and deterministic fallback images are disabled by default. They require explicit opt-in through `ZERNIO_ALLOW_CURATED_ARTWORK_FALLBACK` and `ZERNIO_ALLOW_DETERMINISTIC_FALLBACK`.
- Schedule-slot claims and provider-history checks prevent accidental duplicates. An orphaned pending claim is reclaimed with the same canonical slot key and deterministic provider request ID, so a restart cannot suppress the retry. Documented `existingPost` replays and 409 `existingPostId` conflicts are reconciled against the provider record; only matching content, media, target accounts and a nearby schedule are treated as an already-successful hand-off.
- `ZERNIO_SCHEDULE_RECOVERY_ENABLED=true` safely moves missed same-day slots forward.
- Duplicate checks use `GET /v1/posts`; publishing does not depend on analytics permissions.
- Required platforms default to Facebook and Instagram and can be changed through `ZERNIO_REQUIRED_PLATFORMS`.
- Provider requests use bounded retry/backoff settings from the `ZERNIO_API_RETRY_*` variables.
- Post creation sends a deterministic RFC 4122 UUID in `x-request-id`, allowing safe retries without violating Zernio's header contract.

## Special lanes

- **Mini-series:** planned weekly research can skip a weak week; each part must remain evidence-backed and distinct.
- **Thursday podcast promotion:** image/static social promotion for Turing's Torch. Audio promotion remains owned by the podcast lane.
- **eBooks:** scheduled Tuesday, Thursday and Saturday; the main post requires a valid HTTPS book URL and passes eBook conversion/content gates.
- **Quiz:** schedules separate question and answer posts with distinct artwork.
- **Blog RSS:** publishes the daily blog-social package after the blog service has produced it.

## Configuration

Use `config/production.defaults.env`, `env.template` and `services/zernio/utils/config.js` as the source of truth. The scheduler accepts the AIMS-scoped `ZERNIO_META_API_KEY` or Zernio's canonical `ZERNIO_API_KEY`; an explicit request key takes precedence. Placeholder secret references are treated as unconfigured, and a live run without a usable key fails rather than returning a misleading dry-run success. Keep provider credentials in the deployment secret store.
