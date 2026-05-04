# Test results

## Commands run

```bash
node --check audits/utils/orchestrator.js
node --check audits/routes/seoAeoGeo.js
node --check audits/utils/auditAnalysisJobs.js
node --check audits/utils/seoAeoGeoAnalysis.js
node --check services/shared/utils/ai-config.js
node --check services/shared/utils/ai-service.js
node --check services/shared/utils/jobStore.js
node --check services/shared/utils/stateFile.js
npm run build --silent
```

Result: passed.

## Commands not completed

```bash
npm ci --no-audit --no-fund
npm test
```

Result: not completed in the container. The uploaded repo does not include `node_modules`, and dependency installation failed inside the sandbox before tests could be run. The production CI environment should run the full test suite after installing dependencies.
