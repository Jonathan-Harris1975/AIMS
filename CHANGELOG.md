# Changelog

## SEO + AEO + GEO audit live-gate reliability hardening

- Kept `auditForensic` provider routing on the existing shared OpenRouter configuration in `services/shared/utils/ai-config.js`.
- Added provider request errors with masked response-body snippets so failed OpenRouter/API calls are diagnosable without exposing secrets.
- Added per-call `maxRetries` support to the shared AI requester and used it for audit forensic calls so the website workflow is not trapped behind repeated full-length provider timeouts.
- Reduced the audit forensic per-provider timeout to a bounded production-safe value while preserving provider fallback.
- Changed `/audits/seo-aeo-geo/analysis` to return structured JSON diagnostics on analysis failure instead of falling through to a generic Express 500 body.
- Preserved strict forensic JSON validation and repair flow for malformed model output.
- Added a route-level `/analysis` integration test with a mocked OpenRouter response.
- Added a shared-AI transport test proving audit calls honour `maxRetries=0` and mask secret-looking values in provider error bodies.

## Previous hardening retained

- Callback auth accepts either `AUDIT_CALLBACK_TOKEN` or `AI_SUITE_AUDIT_CALLBACK_TOKEN`.
- The analysis route uses `auditForensic` from shared `ai-config.js` and the existing `OPENROUTER_*` model/key variables.
- The forensic validator rejects empty issue ledgers, missing scores, missing implementation sequence, missing coverage appendices, generic remediations, and duplicated issue remediations.
