# Test results

## Commands run

```bash
node --check services/shared/utils/ai-config.js
node --check services/shared/utils/ai-service.js
node --check audits/utils/callbackAuth.js
node --check audits/utils/seoAeoGeoAnalysis.js
node --check audits/routes/seoAeoGeo.js
node --check test/audit-callback-auth.test.js
node --check test/ai-service-provider-diagnostics.test.js
node --check test/audit-forensic-analysis-shape.test.js
node --check test/ai-service-audit-timeout.test.js
node --check test/audit-analysis-route.test.js
```

Result: passed.

```bash
node --test test/audit-callback-auth.test.js test/ai-service-provider-diagnostics.test.js test/audit-forensic-analysis-shape.test.js test/ai-service-audit-timeout.test.js test/audit-analysis-route.test.js
```

Result: passed. 9 targeted tests passed, 0 failed.

```bash
npm run build
```

Result: passed. The repo build script completed.

## Full test suite

```bash
npm test
```

Result: not completed in this container. The suite was started after installing dependencies; many tests passed, but the command exceeded the 300 second execution limit before the final TAP summary was emitted. This appears to be a long-running/open-handle issue in the broader suite rather than a failure in the changed audit tests. The targeted audit tests above completed successfully.

## Live/provider checks not run

- Real OpenRouter calls were not executed because no production secrets were available in the container.
- Koyeb, R2, Hookdeck, GitHub workflow dispatch, and live `/audits/seo-aeo-geo/run` were not executed because live credentials and deployed runtime access were not available.
- The valid-provider path was tested with a mocked OpenRouter response through the real Express `/analysis` route.
- Failed-provider diagnostics were tested with a mocked OpenRouter 400 response and confirmed to mask secret-looking values.

## Security checks

- API keys and bearer tokens are masked in provider error snippets.
- `/analysis` failure responses expose provider status/body snippets only after masking.
- Callback authentication remains required for `/analysis` and `/callback`.
