# Production fixes

- `routes/index.js` — Mounted the RSS feed router so `/rss` exists alongside `/rss/rewrite`.
- `routes/rss.js` — Aligned the default RSS object key with the writer (`feed.xml`) and stopped returning raw internal errors to clients.
- `env.template` — Corrected `RSS_OBJECT_KEY` default from `rss.xml` to `feed.xml`.
- `services/script/routes/index.js` — Sanitised 500-level route errors while preserving 400 validation details.
- `services/podcast/index.js` — Sanitised route-level 500 responses and added request ID propagation to client-visible failures.
- `services/artwork/routes/createArtwork.js` — Sanitised 500 responses and added request ID propagation.
- `services/artwork/routes/generateArtwork.js` — Sanitised 500 responses and added request ID propagation.
- `services/rss-feed-creator/routes/rewrite.js` — Sanitised 500 responses and added request ID propagation.
- `scripts/fix-logger-usage.js` — Removed import-time side effects so the script only rewrites files when executed directly.
- `deployment-check.js` — Removed import-time process exit side effects by gating execution behind an entrypoint check.
- `test/smoke.test.js` — Added regression coverage for `/rss` route mounting and structured error responses.
