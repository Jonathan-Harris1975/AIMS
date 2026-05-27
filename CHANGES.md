# Changes

## scripts/koyebEnvDoctor.js

- Added a generic guard that rejects Koyeb env values containing literal `...` truncation markers.
- Kept existing secret-reference, numeric, boolean, URL, template and enum checks intact.
- This prevents spreadsheet-display truncation from being accepted as a deployable value.

## scripts/buildCheck.js

- Added build-time validation for checked-in Koyeb env paste files.
- The build still ignores runtime-only process env values, so malformed live Koyeb variables cannot poison image construction.
- The build now fails only when repo-owned env artefacts are invalid.

## koyeb-env/aims.bulk-env.canonical.txt

- Removed confirmed truncated optional values ending in `...`.
- Replaced truncated social RSS and podcast descriptions with complete on-repo defaults.
- Preserved the full canonical `GOOGLE_PRIVATE_KEY={{ secret.GOOGLE_PRIVATE_KEY }}` contract.

## koyeb-env/aims.bulk-env.safe-no-google-private-key.txt

- Removed confirmed truncated optional values ending in `...`.
- Replaced truncated social RSS and podcast descriptions with complete on-repo defaults.
- Preserved the safe build-unblock purpose by keeping `GOOGLE_PRIVATE_KEY` excluded.

## test/koyeb-env-doctor.test.js

- Added regression coverage for generic truncated Koyeb paste values.
- Added coverage that checked-in Koyeb env files pass the env doctor.

## docs/koyeb/STUCK_BUILD_ENV_RUNBOOK.md

- Updated the Koyeb build-stage runbook to explain the new truncation guard and the missing optional values rule.
