# Blotato quality prompt and publish hardening

## Changed files

- `services/blotato/utils/newsShortsService.js`
  - Replaces the generic one-paragraph AI short prompt with a stricter Blotato-specific prompt based on the provided example style: spartan, direct, short sentences, no emojis, no semicolons, no hype wording, source-grounded output.
  - Requires 3 to 5 structured scenes with `mediaSource` and `script` so the Blotato AI Video template receives useful manual inputs instead of an empty `inputs` object.
  - Adds derived scene fallback if the model omits usable scenes.
  - Removes strict `response_format` from the OpenRouter call and adds one controlled JSON repair retry for malformed model output.
  - Exposes `buildBlotatoVideoInputs()` for the auto-publish flow.

- `services/blotato/utils/autoPublishService.js`
  - Sends structured Blotato video inputs to `/v2/videos/from-templates`.
  - Preserves the full Blotato template path and normalises older `base/v2/...` values by adding the leading slash.
  - Hard-caps Instagram captions to five hashtags before publishing.

- `scripts/koyebEnvDoctor.js`
  - Requires `BLOTATO_NEWS_TEMPLATE_ID` to use the full `/base/v2/.../v1` template path.

- `test/blotato-service.test.js`
  - Verifies the improved prompt rules are present.
  - Verifies OpenRouter calls no longer send `response_format`.
  - Verifies structured Blotato scenes are sent.
  - Verifies Instagram output remains within the five-hashtag limit.

- `test/koyeb-env-doctor.test.js`
  - Updates the valid Blotato template test value to the full template path.

- `env.template`, `koyeb-env/*.env`, `koyeb-env/*.txt`, `services/blotato/README.md`, and `docs/koyeb/*.md`
  - Updates Blotato template examples and deployable values to the full `/base/v2/.../v1` path.

## Validation

- `npm test`
- `npm run build`
- `npm run deploy:smoke`
- `env -i ... npm run build`
- `node --check` across all JavaScript files
