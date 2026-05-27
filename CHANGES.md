# Production readiness changes — Koyeb Blotato/state env unblock

## Confirmed issue fixed

The supplied Koyeb env workbook contained a truncated Blotato template value:

```env
BLOTATO_NEWS_TEMPLATE_ID=base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d662...
```

That literal ellipsis is not a valid production template identifier. The corrected value is:

```env
BLOTATO_NEWS_TEMPLATE_ID=base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1
```

## Changed files

- `.dockerignore`
  - Stops ignoring the root `Dockerfile` while still ignoring variant Dockerfiles.
  - Safe because Koyeb Dockerfile deployments need the root Dockerfile available in the build context.

- `Dockerfile`
  - Removes optional external BuildKit syntax frontend line.
  - Adds explicit timeouts around apt and npm install steps so remote builds fail loudly instead of appearing stuck.
  - Safe because the image contents and start command remain unchanged.

- `package.json`
  - Adds `env:doctor` and `env:doctor:file` scripts.
  - Includes the new env doctor test in the existing enumerated test script.

- `scripts/buildCheck.js`
  - Runs critical env validation during build when those env values are present.
  - Safe because valid env values pass unchanged; invalid values now fail with a clear message.

- `scripts/koyebEnvDoctor.js`
  - Adds file/process env validation for Koyeb bulk env blocks.
  - Catches duplicate keys, malformed secret references, invalid booleans/numbers/enums, unsupported default channels, and truncated `BLOTATO_NEWS_TEMPLATE_ID`.

- `test/koyeb-env-doctor.test.js`
  - Locks the regression: truncated Blotato template values fail, the full value passes.

- `koyeb-env/blotato-state-corrected.env`
  - Paste-ready corrected narrowed env group supplied by the user.

- `docs/koyeb/BLOTATO_ENV_BUILD_FIX.md`
  - Documents the confirmed defect and deployment order.

## External contracts preserved

No route paths, request/response JSON shapes, R2 bucket names, webhook contracts, model routing, prompt tone, publication flow, or runtime service names were changed.
