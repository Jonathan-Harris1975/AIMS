# TEST RESULTS

## Syntax checks

```bash
node --check services/shared/utils/ai-config.js
node --check services/shared/utils/ai-service.js
node --check audits/routes/seoAeoGeo.js
node --check audits/utils/auditAnalysisJobs.js
node --check audits/utils/callbackAuth.js
node --check audits/utils/orchestrator.js
node --check audits/utils/seoAeoGeoAnalysis.js
node --check scripts/envBootstrap.js
node --check test/ai-service-provider-diagnostics.test.js
node --check test/audit-analysis-route.test.js
npm run build --silent
```

Result: passed.

## Targeted audit tests

```bash
npm ci --no-audit --no-fund
node --test test/ai-service-provider-diagnostics.test.js test/audit-analysis-route.test.js
```

Result: passed. 5 tests passed, 0 failed.

Covered:

- current Koyeb spreadsheet generic OpenRouter aliases
- older hyphen/dot/underscore OpenRouter aliases
- unresolved Koyeb secret placeholders rejected
- placeholder-specific keys skipped when later generic real keys exist
- async `/analysis` route returns validated forensic JSON through the shared AI route

## Wider test run

```bash
npm test -- --test-timeout=60000
```

Result: not completed in the sandbox. The run exceeded the 300-second tool timeout after many passing tests. No failing assertion was observed before timeout.

## Live checks not run

Real Koyeb deployment, R2 upload, GitHub workflow dispatch, and real OpenRouter calls were not run because production runtime access and secret values are unavailable in the sandbox.
