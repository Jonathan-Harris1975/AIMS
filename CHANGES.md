# production-fixes.zip contents

## Changed files

- `services/shared/utils/jobStore.js`  
  Fixed client-safe job serialisation by adding `sanitizeJobForClient()` so API routes can return job state without exposing stack traces.

- `services/tts/routes/tts.js`  
  Sanitised job payloads returned by `/tts/status/:sessionId` and duplicate-job responses.

- `services/podcast/index.js`  
  Sanitised job payloads returned by `/podcast/status/:sessionId` and duplicate-job responses.

- `services/script/utils/fetchFeeds.js`  
  Added bounded HTTP timeout handling for feed fetches to avoid hanging script generation on slow or stalled feeds.

- `services/artwork/routes/generateArtwork.js`  
  Added bounded HTTP timeout handling for artwork generation requests and removed raw upstream error body leakage.

- `services/tts/utils/podcastProcessor.js`  
  Added bounded HTTP timeout handling for remote fetches and guaranteed temp-file cleanup on failure paths.

- `services/rss-feed-creator/routes/run-rss-route.js`  
  Removed the broken router-as-function call and made the background rewrite trigger call the actual rewrite pipeline.

- `routes/rss.js`  
  Corrected the R2 read call signature, replaced placeholder POST behaviour with the real rewrite pipeline, and normalised JSON responses to use `ok`.

- `services/shared/utils/stateFile.js`  
  Added an explicit production warning when state is being persisted under a temporary filesystem path on an ephemeral container.

- `test/smoke.test.js`  
  Added smoke coverage ensuring job status endpoints no longer expose stack traces.
