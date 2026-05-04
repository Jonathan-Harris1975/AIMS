# Changelog

## Audit callback + forensic analysis hardening

- Restored the asynchronous SEO/AEO/GEO `/analysis` flow so the website workflow does not sit behind a long-running synchronous request.
- Added durable polling support for `/audits/seo-aeo-geo/analysis/:sessionId`.
- Updated the audit workflow dispatch payload to always include both `callback_url` and `analysis_url` when `APP_URL` / `AUDIT_CALLBACK_BASE_URL` and callback auth are configured.
- Added a hard server-side guard so `/run` fails immediately if callback URL or token configuration is missing, instead of dispatching a doomed failed-gate workflow.
- Preserved callback authentication; no unauthenticated analysis/callback path was introduced.
