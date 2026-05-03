# Files changed

- `audits/routes/seoAeoGeo.js`
  - `/analysis` now returns `202 Accepted` quickly and exposes a status endpoint.
  - Added `GET /analysis/:sessionId` for authenticated polling.

- `audits/utils/auditAnalysisJobs.js`
  - New async job manager for SEO/AEO/GEO forensic analysis.

- `audits/utils/callbackAuth.js`
  - Accepts both `AUDIT_CALLBACK_TOKEN` and `AI_SUITE_AUDIT_CALLBACK_TOKEN`.

- `audits/utils/seoAeoGeoAnalysis.js`
  - Uses audit-specific AI timeout/retry/token overrides while still calling the shared AI service.

- `services/shared/utils/ai-service.js`
  - Added per-call `maxRetries` support.
  - Masks sensitive bearer-like content in OpenRouter error snippets.
