# Test results

## Commands run

```bash
node --check audits/utils/auditAnalysisJobs.js
node --check audits/routes/seoAeoGeo.js
node --check audits/utils/seoAeoGeoAnalysis.js
node --check services/shared/utils/ai-service.js
node --check audits/utils/callbackAuth.js
npm run build --silent
```

## Results

- JavaScript syntax checks passed.
- `npm run build --silent` passed and printed `Build step completed`.

## Commands not run

```bash
npm test
```

Not run in this container because the extracted repo does not include `node_modules`, and this environment does not have production secrets or deployed runtime access.

Live `/audits/seo-aeo-geo/run`, real OpenRouter calls, Koyeb deployment, GitHub workflow dispatch, and R2 publishing were not run here.
