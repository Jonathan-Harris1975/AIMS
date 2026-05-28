# AIMS Blotato template ID fix

## Confirmed defect fixed

- The Blotato publish-now path was normalising the configured AI story template path down to the bare UUID `5903fe43-514d-40ee-a060-0d6628c5f8fd`.
- Blotato returned `404 Unknown template ID` for that bare UUID in the observed request.
- The service now sends the full template path expected by the AI Video with AI Voice template: `/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1`.

## Changed files

- `services/blotato/utils/autoPublishService.js` preserves and normalises the full Blotato template path instead of stripping it to a UUID.
- `scripts/koyebEnvDoctor.js` now rejects bare template UUID values for `BLOTATO_NEWS_TEMPLATE_ID` and points to the full path.
- `test/blotato-service.test.js` locks the publish-now flow to send the full template path, while preserving manual visual route behaviour.
- `test/koyeb-env-doctor.test.js` verifies full-path acceptance and bare-UUID rejection.
- `env.template`, `koyeb-env/*.txt`, `koyeb-env/*.env`, `docs/koyeb/*.md`, and `services/blotato/README.md` now show the full `/base/v2/.../v1` template value.

## Validation run

- `npm ci --ignore-scripts --no-audit --no-fund`
- `npm test`
- `npm run build`
- `npm run deploy:smoke`
- `node --check` across repository JavaScript files
- `node scripts/koyebEnvDoctor.js` on the deployable Blotato/AIMS Koyeb env files

## Safe deploy note

Use this value anywhere `BLOTATO_NEWS_TEMPLATE_ID` is still present in Koyeb or local env files:

```env
BLOTATO_NEWS_TEMPLATE_ID=/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1
```
