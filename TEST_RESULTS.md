# Test results

## Passed

```bash
node --check services/shared/utils/ai-config.js
node --check services/shared/utils/ai-service.js
node --check services/shared/utils/jobStore.js
node --check services/shared/utils/stateFile.js
node --check audits/utils/auditAnalysisJobs.js
node --check audits/utils/seoAeoGeoAnalysis.js
node --check audits/routes/seoAeoGeo.js
node --check test/ai-service-provider-diagnostics.test.js
node --check test/audit-analysis-route.test.js
npm run build --silent
```

Result: passed.

## Not run here

```bash
npm test
```

Reason: dependency installation in this container exceeded the available execution window. The supplied CI log showed dependencies are available in GitHub Actions and isolated the failing contract to `test/audit-analysis-route.test.js`, where the test expected completed analysis from a `200` polling response. The test contract has been updated so polling accepts `202` for in-progress analysis and requires `200` only once the forensic JSON is present.

## Evidence from supplied failed report

The uploaded report failed at the AI forensic gate with: `completed but no analysis payload`. This patch prevents pending jobs from being returned as HTTP `200` without analysis.
