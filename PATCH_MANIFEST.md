# AIMS corrected 18 env reconciliation patch

## What changed

- Inserted the 16 previously omitted AIMS env keys into all paste-ready AIMS env files.
- Refreshed the 2 social-blog keys from the corrected workbook.
- Updated `env.template` and `config/production.defaults.env` with the corrected non-secret operational defaults.
- Hardened `scripts/koyebEnvDoctor.js` so literal `...` truncation markers are blocked in any env value.
- Added URL hostname validation to catch malformed public URL values.
- Added tests for generic truncation detection and malformed URL hostname detection.

## Count after reconciliation

- `koyeb-env/aims.bulk-env.canonical.txt`: 259 keys
- `koyeb-env/aims.bulk-env.safe-no-google-private-key.txt`: 258 keys
- `koyeb-env/repo_aims.bulk-env.canonical.txt`: 259 keys
- `koyeb-env/repo_aims.bulk-env.safe-no-google-private-key.txt`: 258 keys
- `koyeb-env/workbook_aims_canonical.env`: 259 keys
- `koyeb-env/workbook_aims_safe.env`: 258 keys
- `env.template`: 272 keys
- `config/production.defaults.env`: 233 keys

The AIMS canonical files now exceed the original workbook count of 254 because the repo already carried 5 local service keys that were not in the workbook.

## Manual correction applied

`R2_PUBLIC_BASE_URL_META_SYSTEM` had a stray `)` in the corrected workbook value. The patch uses the original verified prefix from the Koyeb master workbook and the completed `.r2.dev` suffix:

`https://pub-f1af4f6cf4c14d58abaf43112176431b.r2.dev`

## Verified

- `npm ci --ignore-scripts --no-audit --no-fund`
- `npm test`
- Blog RSS/social/weekly package tests
- `node --check` on changed JavaScript files
- `scripts/koyebEnvDoctor.js` on all main env handoff files, `env.template`, and `config/production.defaults.env`
