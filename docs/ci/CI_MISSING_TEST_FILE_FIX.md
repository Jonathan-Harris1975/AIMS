# CI missing test file fix

## Confirmed CI failure

GitHub Actions failed during `npm test` because `package.json` listed `test/build-check.test.js`, but that file was not present in the commit checked out by CI.

Failure from the uploaded log:

```text
▶ test/build-check.test.js
Could not find 'test/build-check.test.js'
Process completed with exit code 1.
```

## Resolution

Commit the missing test file with the package/test-script changes it belongs to. This patch includes the matching files that must travel together:

- `package.json`
- `scripts/buildCheck.js`
- `scripts/koyebEnvDoctor.js`
- `test/build-check.test.js`
- `test/koyeb-env-doctor.test.js`

## Why this is safe

No runtime routes, request/response contracts, environment variable names, R2 bucket names, model routing, prompts, or storage paths are changed. The fix only restores the test file expected by CI and keeps the env/build checks aligned.
