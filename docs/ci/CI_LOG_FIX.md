# CI log fix: missing Koyeb env doctor test

## Evidence

The uploaded GitHub Actions log fails in the `Run smoke tests` step:

```text
▶ test/koyeb-env-doctor.test.js
Could not find 'test/koyeb-env-doctor.test.js'
Process completed with exit code 1.
```

Earlier tests completed successfully. The failure is therefore not caused by the Blotato env values, durable-state warning text, dependency installation, or JavaScript syntax. It is a repository consistency error: the npm test list includes a test file that was not present in the CI checkout.

## Fix

Commit `test/koyeb-env-doctor.test.js` together with `scripts/koyebEnvDoctor.js`, `scripts/buildCheck.js`, and the matching `package.json` test script.

## Expected result

The existing GitHub Actions workflow should proceed past `test/koyeb-env-doctor.test.js`. Local validation confirms the uploaded repo passes the same CI commands when the file is present.
