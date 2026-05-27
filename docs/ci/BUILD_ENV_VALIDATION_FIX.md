# Build env validation fix

## Issue

The CI log showed a stale expectation in `test/koyeb-env-doctor.test.js`: it still expected Koyeb's spaced secret reference format to be rejected, even though the validator now correctly accepts both supported forms:

```env
BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}
BLOTATO_API_KEY={{secret.BLOTATO_API_KEY}}
```

A deeper deployment trap was also present: `npm run build` executed `scripts/buildCheck.js`, and `buildCheck.js` validated runtime Koyeb environment values from `process.env`.

That made runtime-only settings such as Blotato, Phase 3 gates, state backend, and RSS options capable of blocking the Docker/Koyeb image build even though those values are only needed at runtime or by explicit preflight checks.

## Fix

`buildCheck.js` now validates only build artefacts:

- required source files exist
- `Dockerfile` exists
- `package-lock.json` exists
- lockfile does not point at private/local registries

Runtime env validation remains available through:

```bash
npm run env:doctor
npm run env:doctor:file -- koyeb-env/blotato-state-with-api-key.env
```

## Contract preserved

No API route, response shape, storage key, bucket name, model routing, prompt, or runtime behaviour changed.

The change only prevents runtime env values from being treated as build-time blockers.
