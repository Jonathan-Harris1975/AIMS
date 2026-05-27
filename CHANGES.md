# Changes

## Koyeb Blotato/env build unblock

- Fixed `scripts/koyebEnvDoctor.js` so it accepts Koyeb's documented bulk-edit Secret syntax, e.g. `BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}`.
- Kept validation for genuinely invalid Secret references such as names containing hyphens.
- Updated `test/koyeb-env-doctor.test.js` to lock both supported Secret-reference forms: `{{ secret.NAME }}` and `{{secret.NAME}}`.
- Corrected truncated `BLOTATO_NEWS_TEMPLATE_ID` values in `koyeb-env/aims.bulk-env.canonical.txt` and `koyeb-env/aims.bulk-env.safe-no-google-private-key.txt`.
- Aligned `koyeb-env/blotato-state-with-api-key.env` with Koyeb's documented bulk-edit Secret syntax.
- Updated `docs/koyeb/SECRET_REFERENCE_BUILD_FIX.md` to remove the previous over-strict compact-only advice.

No routes, response contracts, storage keys, R2 aliases, model routing, prompts, or runtime behaviour were changed.
