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
- Artwork is checked for relevance and visual defects before the external side effect.
- Schedule-slot claims and provider-history checks prevent accidental duplicates.
- Required platforms default to Facebook and Instagram and can be changed through `ZERNIO_REQUIRED_PLATFORMS`.
- Provider requests use bounded retry/backoff settings from the `ZERNIO_API_RETRY_*` variables.

## Special lanes

- **Mini-series:** planned weekly research can skip a weak week; each part must remain evidence-backed and distinct.
- **Thursday podcast promotion:** image/static social promotion for Turing's Torch. Audio promotion remains owned by the podcast lane.
- **eBooks:** scheduled Tuesday, Thursday and Saturday; the main post requires a valid HTTPS book URL and passes eBook conversion/content gates.
- **Quiz:** schedules separate question and answer posts with distinct artwork.
- **Blog RSS:** publishes the daily blog-social package after the blog service has produced it.

## Configuration

Use `config/production.defaults.env`, `env.template` and `services/zernio/utils/config.js` as the source of truth. Keep provider credentials in the deployment secret store.
