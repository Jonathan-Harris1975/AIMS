# Changes

## scripts/koyebEnvDoctor.js

- Rejects any paste-ready env value containing a literal three-dot truncation marker.
- Keeps accepting both Koyeb secret reference styles: `{{ secret.NAME }}` and `{{secret.NAME}}`.
- Accepts Koyeb CLI delete directives such as `!CF_purge` for the legacy-env removal helper.
- Preserves existing validation for Blotato numbers, booleans, channels, template IDs, URLs, and state backend values.

## scripts/buildCheck.js

- Adds a build-time guard that validates every repository Koyeb env paste file in `koyeb-env/`.
- Keeps runtime Koyeb env isolated from the build itself, but now prevents broken checked-in paste files from shipping unnoticed.

## koyeb-env/aims.bulk-env.canonical.txt

- Removed unresolved values that were exported with literal three-dot truncation markers.
- No known-good env values were guessed.

## koyeb-env/aims.bulk-env.safe-no-google-private-key.txt

- Removed the same unresolved truncated values from the safer no-Google-private-key paste file.
- Preserved the safe Google private key omission strategy.

## koyeb-env/*.omitted-truncated-values.md

- Added companion lists of omitted keys so the existing Koyeb values can be retained or replaced only with verified full values.

## test/koyeb-env-doctor.test.js

- Added regression coverage for generic truncated env values.
- Added regression coverage for Koyeb CLI delete directives.

## test/build-check.test.js

- Added regression coverage that `npm run build` validates repository Koyeb env paste files.

## docs/koyeb/TRUNCATED_ENV_PASTE_FILE_FIX.md

- Added the production diagnosis, deployment instruction, and validation commands for this fix.
