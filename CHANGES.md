# AIMS Blotato build/sanity unblock patch

## Changed files

### test/koyeb-env-doctor.test.js
- Updated the generic truncated env paste-value assertion to match the validator's current production error wording.
- Keeps the same behavioural contract: values containing literal `...` are still rejected before they can be pasted into Koyeb.
- This fixes the uploaded sanity/build-stage failure without changing runtime routes, environment names, request/response shapes, Blotato API behaviour, storage layout, model routing, or production service code.

## Evidence
- Uploaded logs showed the only failing step was `test/koyeb-env-doctor.test.js`, subtest `koyeb env doctor rejects generic truncated paste values`.
- The validator already rejected the bad value correctly; the assertion was pinned to stale wording: `/truncated value marker/i`.
- The patched assertion now checks the active message for `appears truncated` and `literal ...`.

## Validation
- `npm test` passed.
- `npm run build` passed.
- `npm run deploy:smoke` passed.
- `node --check` passed across repository JavaScript files.
- `npm run env:doctor:file` passed for all checked-in Koyeb env paste files, excluding the delete-directive helper file.
- The exact user-provided Blotato/state env block passed `env:doctor:file` and `npm run build`.
