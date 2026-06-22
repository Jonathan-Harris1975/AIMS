# AIMS image/artwork transport fix

## Problem found

The uploaded log showed the daily social blog build failing to generate artwork with all configured OpenRouter image providers:

- `AI_MODEL_IMAGE=google/gemini-2.5-flash-image`
- `OPENROUTER_ART=google/gemini-2.5-flash-image`
- `OPENROUTER_ART_BACKUP=openai/gpt-5-image-mini`

Each provider failed with `Invalid response body ... Premature close`. The blog pipeline then correctly used the configured fallback image and still completed successfully.

## Root cause

The shared artwork transport was calling OpenRouter chat completions for image models without explicitly setting the image-output `modalities` field. OpenRouter image-generation requests now require `modalities` to request image output through `/chat/completions`.

## Fix applied

- Added a shared OpenRouter image payload helper.
- Added `modalities: ["image", "text"]` to image-generation payloads by default.
- Added `ARTWORK_MODALITIES` / `OPENROUTER_ARTWORK_MODALITIES` override support for image-only models.
- Replaced the OpenAI SDK artwork transport with the existing timeout-aware HTTP client so body-read failures can be retried cleanly.
- Added transient retry handling for `Premature close`, socket resets, timeouts and 5xx/429 responses.
- Unified legacy `/artwork/generate` and route-based `/artwork/generate` paths onto the same shared artwork generator.
- Replaced the stale `services/artwork/artwork.js` duplicate with a backwards-compatible barrel export so older imports no longer point at a broken local import path.
- Passed blog artwork date/week context through to the prompt policy.
- Added a regression test that verifies OpenRouter artwork payloads request image modalities.

## Blast-radius check

Log review indicates:

- `blog-social/daily-build` succeeded with fallback image.
- RSS rewrite succeeded.
- Outreach batch succeeded.
- Health, preflight and warmup routes returned 200.
- The OneUp ebook weekly issue was unrelated: a content review gate rejected Saturday copy for an inflated claim.
- The artwork bug could affect blog weekly artwork, podcast artwork and manual `/artwork/generate`, because those paths share the same image transport.

## Validation run

- Syntax check passed for all changed files.
- Targeted regression test passed:
  `node --test --test-name-pattern "payload" test/openrouter-service-routing.test.js`

Full test suite was not run in the sandbox because dependencies were not installed; the broader existing OpenRouter test file imports `logger.js`, which requires `pino` from `node_modules`.
