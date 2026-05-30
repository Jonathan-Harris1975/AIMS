# AIMS CI fix manifest

Generated: 2026-05-30

## Error log addressed

- GitHub Actions failed in `test/blotato-service.test.js` because `services/blotato/utils/autoPublishService.js` imported `services/social/editorialLedger.js`, but the file was missing in the CI checkout.

## Files included

- `services/social/editorialLedger.js`
- `services/blotato/utils/autoPublishService.js`
- `services/blotato/utils/shortLanes.js`
- `services/shared/middleware/suiteAuth.js`
- `test/blotato-service.test.js`
- `test/suite-auth.test.js`
- `docs/social-coverage-operating-notes.md`

## Behavioural changes

- Restores the missing shared editorial ledger module required by OneUp, Blotato, blog social, RSS and podcast-facing workflows.
- Keeps Blotato short lanes to the existing Monday-Friday set only.
- Keeps LinkedIn documented as not required.
- Keeps weekend Blotato expansion documented as a future monitoring decision, not an active automation change.
- Normalises generated Blotato captions before the short gate so Instagram, TikTok and YouTube captions are capped at five hashtags before validation and publish.
- Removes public unauthenticated allow-listing for discontinued weekend Blotato publish-now routes.
- Updates Blotato/suite-auth tests to match the five-lane weekday-only policy and the stricter Blotato gate.

## Validation run

- `find . -name '*.js' -not -path './node_modules/*' -print0 | while IFS= read -r -d '' file; do node --check "$file" || exit $?; done` passed.
- `npm test` passed.

## Cleanup note

- If a stray `services/social/1` file exists in the working tree, delete it. It is not required and is not included in this package.
