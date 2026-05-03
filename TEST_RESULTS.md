# Test results

## Commands run

```bash
node --check services/shared/utils/stateFile.js
node --check services/shared/utils/jobStore.js
node --check audits/utils/auditAnalysisJobs.js
node --check audits/routes/seoAeoGeo.js
npm run build --silent
```

## Results

All syntax checks passed.

`npm run build --silent` passed and printed `Build step completed`.

## Not run

Full `npm test` was not run because the extracted upload does not include `node_modules`, and route-level tests require runtime dependencies such as `express`, `supertest`, and AWS SDK packages.

Live Koyeb, R2, GitHub workflow dispatch, and real OpenRouter calls were not run because production runtime access and live secrets are not available in this environment.
