# Test results

## Commands run in container

```bash
node --check services/shared/utils/ai-service.js
node --check audits/utils/auditAnalysisJobs.js
node --check test/ai-service-audit-timeout.test.js
node --check test/ai-service-provider-diagnostics.test.js
node --check test/audit-analysis-route.test.js
node --check audits/routes/seoAeoGeo.js
```

Result: passed.

## Commands not fully run in container

```bash
npm ci --no-audit --no-fund
npm test
```

Result: not completed in the container because dependency installation timed out. The uploaded CI log proves dependency installation succeeds in GitHub Actions, so the relevant CI failures were addressed in code and tests:

- `test/ai-service-audit-timeout.test.js` expected `AIProviderRequestError`; OpenRouter HTTP errors now set that name.
- `test/ai-service-provider-diagnostics.test.js` expected the previous four-provider audit route; the test now reflects the expanded Koyeb/OpenRouter route.
- `test/audit-analysis-route.test.js` expected sync `200`; the test now follows the async `202` plus polling contract.

## Live audit failure addressed

The latest failed report shows the polling endpoint reached a `completed` state but did not expose a top-level analysis payload. This patch makes the polling response compatible with both current and legacy completed job shapes and stores the analysis in both locations for new jobs.
