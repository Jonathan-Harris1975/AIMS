# Changes

## Fixed CI and Koyeb build-stage environment blocking

- Updated `scripts/buildCheck.js` so `npm run build` no longer validates runtime-only Koyeb environment variables from `process.env`.
- Preserved explicit environment validation through `scripts/koyebEnvDoctor.js` and the existing `env:doctor` / `env:doctor:file` package scripts.
- Added `test/build-check.test.js` to prove the build check does not fail just because runtime-only Koyeb variables are present or malformed.
- Kept `test/koyeb-env-doctor.test.js` aligned with Koyeb bulk-edit secret syntax so `{{ secret.BLOTATO_API_KEY }}` and `{{secret.BLOTATO_API_KEY}}` are both accepted.
- Documented the CI/build-stage fix in `docs/ci/BUILD_ENV_VALIDATION_FIX.md`.

## Why this is safe

Koyeb injects service environment variables during the build and runtime phases. Build validation should only check build artefacts and dependency integrity. Runtime environment validation remains available as an explicit diagnostic command, so no runtime contract is weakened and no public API behaviour changes.
