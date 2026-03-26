# Production fixes applied in this pass

## Core reliability and security
- `services/shared/utils/stateFile.js`
  - Added optional durable state replication to the R2 metasystem bucket.
  - Keeps local atomic writes as fallback, but now hydrates and mirrors state remotely when `R2_BUCKET_META_SYSTEM` is configured.
  - Warns clearly when production is still using ephemeral local-only state.

- `services/shared/utils/jobStore.js`
  - Sanitises persisted job errors so stack traces are not stored in job state.
  - Added `getPublicJob()` / `toPublicJob()` for safe client-facing job status responses.

- `services/tts/routes/tts.js`
  - Uses sanitised public job payloads for `/tts/status/:sessionId`.

- `services/podcast/index.js`
  - Uses sanitised public job payloads for `/podcast/status/:sessionId`.

## Network timeout hardening
- `services/shared/http-client.js`
  - Centralised timeout-aware fetch wrapper retained and tightened for reuse.

- `routes/podcast-pipeline.js`
  - Internal orchestration fetches now use bounded timeouts.

- `services/artwork/routes/generateArtwork.js`
  - OpenRouter artwork calls now use bounded timeouts.

- `services/artwork/createPodcastArtwork.js`
  - Added timeout guard around podcast artwork generation.

- `services/artwork/createBlogArtwork.js`
  - Added timeout guard around blog artwork generation.

- `services/rss-feed-creator/utils/shortio.js`
  - Short.io requests now use bounded timeouts and safe fallback behaviour.

- `services/script/utils/fetchFeeds.js`
  - RSS feed fetching now uses bounded timeouts.

- `services/tts/utils/podcastProcessor.js`
  - Metadata, edited audio, intro, and outro fetches now use bounded timeouts.
  - Temp files are always cleaned up in a `finally` block.

## API contract clean-up
- `services/tts/routes/info.js`
  - Normalised responses to `{ ok: true/false }`.

- `services/tts/routes/merge.js`
  - Normalised responses to `{ ok: true/false }`.

- `services/tts/routes/podcast.js`
  - Normalised responses to `{ ok: true/false }`.

- `routes/rss.js`
  - Fixed broken R2 read usage and normalised response shape.
  - Replaced placeholder POST behaviour with the real rewrite pipeline.

- `services/rss-feed-creator/routes/run-rss-route.js`
  - Removed the broken router-as-function call path and now runs the rewrite pipeline directly.

## Configuration
- `env.template`
  - Added documented timeout and state backend environment variables.

## Validation
- `test/smoke.test.js`
  - Added coverage confirming job status responses do not expose stack traces.
