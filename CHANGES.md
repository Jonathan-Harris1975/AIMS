# Changes

## CI test-file synchronisation

### `test/build-check.test.js`
- Restores the test file referenced by `package.json`.
- Verifies `scripts/buildCheck.js` does not validate runtime-only Koyeb environment variables during build.
- Fixes the confirmed CI error: `Could not find 'test/build-check.test.js'`.

### `test/koyeb-env-doctor.test.js`
- Keeps the env-doctor contract aligned with Koyeb-supported secret syntax.
- Confirms the narrowed Blotato/state env set validates successfully.

### `scripts/buildCheck.js`
- Keeps build validation limited to build artefacts and lockfile registry sanity.
- Does not validate runtime-only Koyeb env vars during image build.

### `scripts/koyebEnvDoctor.js`
- Keeps env validation available as an explicit diagnostic command.
- Accepts both Koyeb bulk-edit and compact secret reference syntax.

### `package.json`
- Keeps the CI test script aligned with the restored test files.

## Validation

Validated locally against the uploaded repository:

```bash
npm ci --no-audit --no-fund
npm test
npm run build
npm run deploy:smoke
```

All commands passed.
