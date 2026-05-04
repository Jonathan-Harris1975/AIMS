# Test results

## Passed

```bash
node --check services/shared/utils/ai-config.js
node --check services/shared/utils/ai-service.js
node --check scripts/envBootstrap.js
node --check audits/utils/orchestrator.js
node --check audits/utils/githubDispatch.js
node --check audits/routes/seoAeoGeo.js
node --check audits/utils/auditAnalysisJobs.js
node --check audits/utils/seoAeoGeoAnalysis.js
node --check test/ai-service-provider-diagnostics.test.js
node --check test/audit-analysis-route.test.js
npm run build --silent
```

Result: passed.

```bash
npm ci --no-audit --no-fund
node --test test/ai-service-provider-diagnostics.test.js test/audit-analysis-route.test.js
```

Result: passed. 5 tests passed, 0 failed.

Coverage included:
- Current Koyeb spreadsheet model env names with one shared `OPENROUTER_API_KEY`.
- Legacy hyphen/dot/provider-specific aliases.
- Rejection of unresolved `{{ secret.* }}` placeholders.
- Use of the shared OpenRouter key when provider-specific placeholder aliases exist.
- Async `/analysis` accepting, polling, and returning validated forensic JSON.

## Not run

Full `npm test` was not run in the sandbox because the repo-wide suite has repeatedly exceeded the available execution window. Targeted audit/AI tests passed after dependency installation.

Live Koyeb deployment, GitHub workflow dispatch, R2 publishing, and real OpenRouter calls were not run because production runtime access and secrets are unavailable here.
