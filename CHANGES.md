# CI smoke-test unblock patch

## Confirmed issue from uploaded CI log

GitHub Actions failed in the `Run smoke tests` step because `package.json` enumerated `test/koyeb-env-doctor.test.js`, but that file was not present in the branch checked out by CI.

```text
▶ test/koyeb-env-doctor.test.js
Could not find 'test/koyeb-env-doctor.test.js'
Process completed with exit code 1.
```

## Changed files

- `test/koyeb-env-doctor.test.js`
  - Adds the missing test file referenced by the existing npm test command.
  - Locks the env regression already being guarded: truncated Blotato template IDs fail, the full template ID passes, malformed Koyeb secret references fail, and the narrowed Blotato/state env group passes validation.

- `scripts/koyebEnvDoctor.js`
  - Includes the helper imported by the missing test.
  - Validates Koyeb env files and process env values for duplicate keys, malformed secret references, invalid number/boolean/enum values, unsupported Blotato channels, and truncated `BLOTATO_NEWS_TEMPLATE_ID`.

- `scripts/buildCheck.js`
  - Keeps build-time validation wired to the env doctor so invalid Koyeb env values fail loudly.

- `package.json`
  - Kept aligned with the test list and `env:doctor` scripts.

## Safety notes

- No runtime routes, public request/response shapes, R2 bucket names, webhook contracts, model routing, prompt behaviour, or storage layout are changed.
- This patch fixes the CI contract mismatch: the test runner references a file that must be committed with the repo.

## Validation run locally

- `npm ci --no-audit --no-fund`
- CI envBootstrap grep check
- `node --check` across all JavaScript files
- `npm test`
- `npm run build`
- `npm run deploy:smoke`
