# Koyeb eMedium & OpenRouter Optimisation Implementation Report

## Executive summary

The repository already had a solid base for Koyeb: a single Express process, `0.0.0.0` port binding, a fast `/health` endpoint, backgrounded podcast jobs, duplicate job guards, ESM compatibility, and graceful shutdown handling.

The implementation therefore stayed deliberately small. The changes focus on eMedium-safe defaults, bounded parallel work, OpenRouter cost-aware routing, safer ffmpeg timeouts, and a clearer environment control layer.

## What changed

- Added role-based OpenRouter model routing through `AI_MODEL_FAST`, `AI_MODEL_STANDARD`, `AI_MODEL_HIGH_QUALITY`, `AI_MODEL_AUDIT`, `AI_MODEL_JSON`, `AI_MODEL_SUMMARY`, `AI_MODEL_FALLBACK`, and `AI_MODEL_IMAGE`.
- Preserved the existing Koyeb spreadsheet OpenRouter model variables as fallbacks.
- Added OpenRouter provider options for price/latency/throughput sorting, fallbacks, JSON parameter support, service tier, provider order/only/ignore, and safe usage logging.
- Reduced default TTS concurrency to 1 and made chunk retry defaults more conservative.
- Bounded RSS feed fetching with `FEED_FETCH_CONCURRENCY`.
- Made ZeroBounce batch size, timeout, and delay env-driven.
- Added ffmpeg timeout protection to merge/edit/master audio processing.
- Added env-driven merge batch sizing and temp directory overrides.
- Updated `env.template` and `scripts/envBootstrap.js` with the new control variables.
- Added this implementation report and the environment review table.

## Koyeb eMedium strategy

- One Node process, no clustering.
- Audio/ffmpeg paths stay conservative: effective concurrency 1 and merge batch size 2.
- AI calls use low retry counts plus model/provider fallback instead of repeated expensive retries.
- RSS/network work is bounded separately from audio and AI work.
- Temp files stay under `/tmp` by default and can be routed under `APP_TMP_DIR`.
- Health checks remain fast and independent of external APIs.

## OpenRouter strategy

- Keep `OPENROUTER_API_KEY` as the primary shared key.
- Prefer role-based models for task classes rather than one global model.
- Use fast/cheap models for metadata, summaries, titles and simple JSON.
- Use stronger models for audit reasoning and higher-value editorial work.
- Enable usage logging without prompt bodies or secrets.
- Support OpenRouter routing controls via env, not hard-coded logic.

## Changed files

| File | Purpose |
|---|---|
| `services/shared/utils/ai-config.js` | Role-based OpenRouter model routing while preserving spreadsheet model variables. |
| `services/shared/utils/ai-service.js` | OpenRouter base URL alias, provider routing options, service tier, usage/cost metadata logging, and safer response extraction. |
| `services/tts/utils/ttsProcessor.js` | Conservative TTS concurrency/retry defaults for eMedium. |
| `services/rss-feed-creator/utils/fetchFeeds.js` | Bounded RSS feed fetch concurrency via `FEED_FETCH_CONCURRENCY`. |
| `services/tts/utils/mergeProcessor.js` | Env-driven temp dir, merge batch size, cleanup delay, download timeout, and ffmpeg timeout protection. |
| `services/tts/utils/editingProcessor.js` | Env-driven temp dir and ffmpeg/ffprobe timeout protection. |
| `services/tts/utils/podcastProcessor.js` | Env-driven temp dir and shared podcast ffmpeg timeout. |
| `services/outreach/services/zeroBounceBatch.js` | Env-driven ZeroBounce batch size, timeout and pacing delay. |
| `scripts/envBootstrap.js` | Added/updated env contract defaults for Koyeb/OpenRouter controls. |
| `env.template` | Added recommended Koyeb eMedium and OpenRouter baseline values. |
| `KOYEB_OPENROUTER_ENV_REVIEW.md` | Full masked environment variable review table. |
| `KOYEB_E_MEDIUM_IMPLEMENTATION_REPORT.md` | Summary of implementation, verification and deployment notes. |

## Testing performed

- `npm run build` passed.
- `npm ci --prefer-offline --no-audit --no-fund` passed after the first plain `npm ci` was terminated by the shell timeout.
- `node --check` passed for every changed JavaScript file.
- Targeted tests passed: `node --test job-store.test.js test/ai-service-audit-timeout.test.js test/ai-service-provider-diagnostics.test.js test/openrouter-service-routing.test.js test/feed-fetching.test.js test/merge-processor.test.js test/rss-feed-creator-brand.test.js`.
- `npm run check:startup` passed with expected warnings for missing local R2 env values.
- Full `npm test` was started and reached 91 passing subtests before the shell timeout terminated the command. The targeted suite above covered the changed areas successfully.

## Remaining risks

- Live OpenRouter model availability and pricing should be checked against the account before committing the exact role-model choices in production.
- Real podcast/audio throughput still depends on Koyeb CPU availability and ffmpeg workload size.
- R2-backed features cannot be fully end-to-end tested locally without the live R2 bucket env values.
- Outreach performance depends on third-party API rate limits and credit availability.
