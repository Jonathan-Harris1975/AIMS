# AIMS production-readiness patch

## Changed files

### `.dockerignore`
- Replaced the broad `Dockerfile*` ignore pattern with `Dockerfile.*` and explicitly unignored the root `Dockerfile`.
- Why safe: this only affects build-context packaging. It does not alter runtime code, environment contracts, routes, storage keys, prompts, or API shapes.
- Production reason: the repository documentation and Koyeb deployment path expect the root `Dockerfile` to remain visible to Dockerfile-based builders.

### `scripts/buildCheck.js`
- Added a deployment sanity check that fails `npm run build` if `.dockerignore` hides the root `Dockerfile` through `Dockerfile` or `Dockerfile*`.
- Added `.dockerignore` to the files asserted by the build check.
- Why safe: the check is read-only and runs only during the existing build validation path. It preserves existing lockfile registry validation and startup-entry file checks.

## Validation run

- `npm ci --ignore-scripts --no-audit --no-fund` ✅
- `node --check scripts/buildCheck.js` ✅
- `npm run build` ✅
- `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` ✅
- `npm run deploy:smoke` ✅
- `npm test` ✅
- `node --test --test-concurrency=1 --test-timeout=120000 --test-force-exit test/*.test.js job-store.test.js` ✅, 171 passing

## Deployment note

Keep Koyeb on the Dockerfile builder where possible:

- Builder: Dockerfile
- Dockerfile path: `Dockerfile`
- Exposed port: `3000`
- Start command: blank, or image default `npm start`

The smoke run still logs expected warnings when real production secrets are not present locally, notably R2 durable state and artwork OpenRouter env warnings. These were not changed because the supplied Koyeb env workbook contains the relevant production env rows and the local sandbox does not have real secrets.
