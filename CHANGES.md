# Changes

## Koyeb Blotato env build unblock

- Added `scripts/koyebEnvDoctor.js` to validate the narrowed Koyeb env set before deployment.
- Updated `scripts/buildCheck.js` so `npm run build` fails loudly when risky Koyeb env values are present.
- Added `test/koyeb-env-doctor.test.js` and wired it into `npm test`/`npm run test:smoke`.
- Added `koyeb-env/blotato-state-with-api-key.env` with the corrected compact Secret reference `BLOTATO_API_KEY={{secret.BLOTATO_API_KEY}}`.
- Added `docs/koyeb/SECRET_REFERENCE_BUILD_FIX.md` documenting the required Koyeb action.

No routes, response contracts, storage keys, R2 aliases, model routing, prompts, or runtime behaviour were changed.
