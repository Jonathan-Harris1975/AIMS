# Koyeb env processing unblock patch

## Changed files

### package.json
- Preserves the existing `env:audit` and `env:audit:file` commands, but points them at the new checked-in env doctor script instead of a missing script path.
- Adds explicit `env:doctor`, `env:doctor:file`, and `env:doctor:live` commands.

### scripts/koyebEnvDoctor.js
- Adds a dependency-free Koyeb environment validator.
- Checks bulk env files and live process envs for duplicate keys, invalid names, malformed Koyeb interpolation, raw multiline values, and build/platform-sensitive variables.
- Redacts values by design and never prints secret contents.

### koyeb-env/aims.bulk-env.canonical.txt
- Provides a canonical paste-ready AIMS env block.
- Fixes `API_SECRET_PODCAST_INDEX` so it references `{{ secret.API_SECRET_PODCAST_INDEX }}` instead of the API key secret.
- Uses the existing supported uppercase alias `BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}` to avoid mixed-case env/secret handling in Koyeb.
- Normalises all secret references to `{{ secret.NAME }}`.

### koyeb-env/aims.bulk-env.safe-no-google-private-key.txt
- Same as canonical AIMS env, but excludes `GOOGLE_PRIVATE_KEY`.
- This is the first deploy unblock file when Koyeb sticks during env processing. It isolates the only expected multiline secret.

### koyeb-env/rams.bulk-env.canonical.txt
- Provides a canonical paste-ready RAMS env block with normalised secret reference formatting.

### koyeb-env/remove-legacy-conflicts.cli-env.txt
- Lists old conflict keys to remove when using Koyeb CLI style env updates.

### docs/koyeb/STUCK_BUILD_ENV_RUNBOOK.md
- Documents the exact deployment sequence for the stuck-building failure.
- Calls out the private-key handling rule and the corrected secret names.

## Confirmed defects fixed

1. `package.json` referenced a missing `scripts/koyebEnvAudit.js` script.
2. `API_SECRET_PODCAST_INDEX` was mapped to the wrong Koyeb secret reference.
3. The AIMS env block used the mixed-case `Blotato_API_key` name even though the app already supports the uppercase `BLOTATO_API_KEY` fallback.
4. The full env set has one likely Koyeb processing hazard: `GOOGLE_PRIVATE_KEY`, if the live Koyeb secret is stored as raw multiline text instead of escaped `\n` text.

## Why this patch is safe

- No route, API response, R2 bucket/key, prompt, model, scheduling, storage layout, or runtime contract was changed.
- `BLOTATO_API_KEY` is already supported by the existing Blotato client as a fallback alias.
- The env doctor is opt-in and does not run during app startup.
- The safe env file removes only `GOOGLE_PRIVATE_KEY`; the canonical env file keeps the full production contract.

## Validation run

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --check scripts/koyebEnvDoctor.js
npm run env:doctor:file -- koyeb-env/aims.bulk-env.canonical.txt
npm run env:doctor:file -- koyeb-env/aims.bulk-env.safe-no-google-private-key.txt
npm run env:doctor:file -- koyeb-env/rams.bulk-env.canonical.txt
npm run build
npm run deploy:smoke
npm test
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run build
npm run deploy:smoke
```
