# Production Fixes

## Changed files

- `logger.js`  
  Fixed production logger environment parsing, replaced the non-standard Unicode `messageKey`, and added argument normalisation so existing `log.info("msg", { ... })` calls emit structured metadata instead of silently dropping fields.

- `server.js`  
  Tightened CORS fallback behaviour, added request rate limiting, standardised `/health` to `{ ok: true }`, and kept error responses consistent.

- `scripts/bootstrap.js`  
  Replaced `execFileSync` startup steps with timeout-bound async child-process execution and delayed `server.js` import until checks complete.

- `scripts/startupCheck.js`  
  Removed side-effectful dynamic imports and replaced them with static relative-import existence checks plus binary validation.

- `services/shared/middleware/rateLimit.js`  
  Added production-safe in-memory rate limiting middleware with cleanup and `Retry-After` support.

- `services/script/routes/index.js`  
  Standardised `/script/orchestrate` success responses to include `ok: true` and `sessionId` consistently.

- `services/tts/routes/tts.js`  
  Changed async job-start responses from `200` to `202` for accepted background work.

- `services/podcast/index.js`  
  Changed async pipeline-start responses from `200` to `202` for accepted background work.

- `services/rss-feed-creator/routes/rewrite.js`  
  Standardised route responses to the repository-wide `{ ok: true/false, ... }` shape.

- `services/rss-feed-podcast/generateFeed.js`  
  Added uppercase documented environment variable support for podcast iTunes and funding metadata, with backward-compatible fallbacks.

- `services/shared/utils/keepalive.js`  
  Prevented keepalive timers from holding the process open unnecessarily by using `unref()`.

- `env.template`  
  Documented environment variables actually used by the codebase, corrected the `SHIPPER` typo, and added missing body-limit, state-path, rate-limit, timeout, and podcast metadata variables.

- `test/smoke.test.js`  
  Updated smoke tests for the new `/health` shape, explicit `202 Accepted` semantics, and disabled rate limiting during test runs.

## Not changed on purpose

- File-backed job and Hookdeck dedupe state were **not** migrated in this patch set. That requires a product decision on the canonical production backing store (R2 metadata object, Redis, or another external store) and should not be guessed inside an audit patch.
- External API timeout/abort coverage was **not** normalised across every service in this patch set because the correct timeout budgets depend on expected workload and upstream SLAs.
