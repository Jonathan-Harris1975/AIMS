# Files changed

- `services/shared/utils/ai-service.js`
  - Dynamic env resolution for configured providers.
  - OpenRouter HTTP errors now use `AIProviderRequestError`.
  - Duplicate provider aliases are skipped when they resolve to the same model/key pair.

- `audits/utils/auditAnalysisJobs.js`
  - Completed jobs now store forensic analysis in both `analysis` and `result.analysis`.
  - Polling responses now resolve analysis from current and legacy job shapes.
  - Added `hasAnalysis` to make the polling contract explicit.

- `test/ai-service-provider-diagnostics.test.js`
  - Updated for the Koyeb OpenRouter env names and expanded audit provider chain.

- `test/audit-analysis-route.test.js`
  - Updated for the async analysis contract: POST returns `202`, then GET polling returns completed analysis.

- `CHANGELOG.md`
- `FILES_CHANGED.md`
- `TEST_RESULTS.md`
