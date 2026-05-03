# Test results

## Commands run

```bash
node --check services/shared/utils/ai-config.js
node --check services/shared/utils/ai-service.js
node --check audits/utils/auditAnalysisJobs.js
node --check audits/utils/seoAeoGeoAnalysis.js
node --check audits/routes/seoAeoGeo.js
npm run build --silent
```

Result: passed.

## Commands not run

```bash
npm test
```

Not run in the container because `node_modules` is not present in the uploaded repo snapshot and dependency installation was not available reliably in this environment.

Live Koyeb, OpenRouter, R2, and GitHub workflow calls were not run because production runtime access and resolved secrets are not available inside the container.
