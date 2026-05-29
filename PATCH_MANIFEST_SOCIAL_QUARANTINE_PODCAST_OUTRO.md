# Patch manifest: social blog quarantine + podcast outro hardening

## Changed files

- `services/content-quality/phase5OrganicGrowthGates.js`
  - Source-safety checks now ignore non-claim generated fields such as URLs, image URLs, keys, buckets, slugs and paths.
  - Date/time/aspect-ratio fragments are no longer treated as unsupported editorial metrics.

- `services/script/utils/orchestrator.js`
  - Editorial pass now runs on the main section only, then recomposes with the deterministic generated intro and outro.
  - This prevents the LLM editorial pass from deleting or changing the exact branded outro line.

- `test/phase5-organic-growth-gates.test.js`
  - Added regression coverage for the `2026-05-28` image URL/date-fragment false positive.

## Verification

- `npm ci --ignore-scripts --no-audit --no-fund`
- `npm test`
- `npm run build`
- `node --test test/phase5-organic-growth-gates.test.js test/blog-social-package.test.js test/blog-social-schema.test.js test/blog-social-rss-feed.test.js test/scriptValidation.test.js test/podcast-metadata.test.js`
- Replayed the uploaded quarantine JSON through the patched Phase 5 gate: result `auto_publish`, score `99`, no defects.

## Safe-for-deletion files from this patch

None.
