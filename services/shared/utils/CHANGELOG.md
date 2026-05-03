# CHANGELOG

## 2026-05-03 — SEO/AEO/GEO audit forensic gate hardening v3

- Converted `/audits/seo-aeo-geo/analysis` from a long-running synchronous request into a fast async job handoff.
- Added authenticated polling at `/audits/seo-aeo-geo/analysis/:sessionId` so the website workflow can wait for validated AI output without hitting Cloudflare/Koyeb gateway timeouts.
- Added `audits/utils/auditAnalysisJobs.js` using the existing shared `jobStore` for durable job status and result persistence.
- Kept AI provider resolution inside `services/shared/utils/ai-config.js` and `services/shared/utils/ai-service.js`.
- Added audit-specific AI controls through existing request options: `AUDIT_AI_MAX_RETRIES`, `AUDIT_AI_TIMEOUT_MS`, `AUDIT_AI_MAX_TOKENS`, `AUDIT_AI_TEMPERATURE`, and `AUDIT_AI_TOP_P`.
- Updated callback auth to accept either `AUDIT_CALLBACK_TOKEN` or `AI_SUITE_AUDIT_CALLBACK_TOKEN`.
- Masked bearer-like strings in provider error snippets.
