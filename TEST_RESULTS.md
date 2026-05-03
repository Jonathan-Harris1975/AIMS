# Test results

## Commands run

```bash
node --check services/shared/utils/ai-config.js
node --check services/shared/utils/ai-service.js
node --check audits/utils/callbackAuth.js
node --check audits/utils/seoAeoGeoAnalysis.js
node --check test/audit-callback-auth.test.js
node --check test/ai-service-provider-diagnostics.test.js
node --check test/audit-forensic-analysis-shape.test.js
```

Result: passed.

```bash
node --test test/audit-callback-auth.test.js test/ai-service-provider-diagnostics.test.js test/audit-forensic-analysis-shape.test.js
```

Result: passed. 7 tests passed, 0 failed.

## Not run

```bash
npm test
```

Not run in this container because the extracted repo does not include `node_modules`, and a full dependency install is outside this patch package. The targeted tests above are dependency-light and exercise the changed code paths.

## Live/provider checks not run

- Real OpenRouter calls were not executed because no production secrets were available in the container.
- Koyeb, R2, Hookdeck, GitHub workflow dispatch, and live `/audits/seo-aeo-geo/run` were not executed because live credentials and deployment runtime were not available.
- The valid-provider path was verified structurally by env-name tests and syntax checks; production verification still requires one configured `auditForensic` provider pair in the deployed environment.

## Security checks

- No API keys or token values are printed by the new diagnostics.
- Invalid callback-token responses do not expose the expected token.
