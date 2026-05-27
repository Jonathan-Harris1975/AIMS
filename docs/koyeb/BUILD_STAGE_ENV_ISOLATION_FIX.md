# Koyeb build-stage env isolation fix

## Confirmed issue

The repo can build locally with the narrowed Blotato/Phase 3/state env group, but Koyeb exposes service environment variables during deployment/build handling. Runtime-only values such as `BLOTATO_API_KEY`, Blotato polling settings, RSS settings, and state backend settings must not be allowed to influence dependency installation or image build validation.

The safest production fix is to make build-stage commands deterministic by running them under a minimal environment. Runtime env validation remains available through the explicit env doctor command instead of being folded into the image build path.

## Applied fix

- Dockerfile production dependency install now runs through `env -i` with only required npm/build variables preserved.
- Dockerfile now runs `npm run build` inside the image build under the same minimal environment.
- Nixpacks fallback install/build commands also run under `env -i`.
- `scripts/buildCheck.js` now enforces this so future patches cannot accidentally reintroduce runtime-env-sensitive builds.
- R2 client calls now use an abort timeout through `R2_REQUEST_TIMEOUT_MS` so remote state/R2 operations cannot hang indefinitely during startup or background hydration.

## Runtime behaviour preserved

No routes, env variable names, response shapes, R2 bucket aliases, Blotato payloads, model choices, prompt logic, or storage keys were changed.

The listed env group remains valid for runtime:

```env
PHASE3_AUTOPUBLISH_MIN_SCORE=85
PHASE3_SOURCE_MIN_CHARS=180
PHASE3_MAX_SENTENCE_WORDS=34
PHASE3_MAX_PODCAST_SENTENCE_WORDS=26
STATE_BACKEND=auto
ALLOW_EPHEMERAL_STATE=false
BLOTATO_DEFAULT_CHANNELS=instagram,youtube
BLOTATO_YOUTUBE_PRIVACY_STATUS=public
BLOTATO_YOUTUBE_NOTIFY_SUBSCRIBERS=false
BLOTATO_INSTAGRAM_SHARE_TO_FEED=true
BLOTATO_NEWS_TEMPLATE_ID=base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1
BLOTATO_VIDEO_POLL_ATTEMPTS=90
BLOTATO_VIDEO_POLL_INTERVAL_MS=3000
BLOTATO_POST_POLL_ATTEMPTS=60
BLOTATO_POST_POLL_INTERVAL_MS=3000
BLOTATO_INSTAGRAM_ACCOUNT_ID=48812
BLOTATO_YOUTUBE_ACCOUNT_ID=37622
BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}
BLOTATO_API_BASE=https://backend.blotato.com/v2
BLOTATO_TIMEOUT_MS=30000
BLOTATO_NEWS_SHORT_MAX_TOKENS=2200
BLOTATO_NEWS_RSS_URL=https://ai-news.jonathan-harris.online/feed.xml
BLOTATO_RSS_PREFER_R2=true
BLOTATO_RSS_BUCKET_ALIAS=rss
BLOTATO_RSS_JSON_KEY=feed.json
BLOTATO_RSS_PICK_MODE=latest
```

## Validation

Run:

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --check scripts/buildCheck.js
node --check services/shared/utils/r2-client.js
npm run env:doctor:file -- koyeb-env/blotato-state-with-api-key.env
npm run build
npm run deploy:smoke
npm test
```

Expected result: all commands pass.
