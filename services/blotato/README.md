# Blotato service

**Live route prefix:** `/blotato`

Blotato produces and publishes short-form video using AIMS-generated scripts, lane-specific visual rules and the Blotato rendering/social APIs.

## Main HTTP contract

- `GET /blotato/health`
- account, sub-account and template discovery routes
- visual creation/status/deletion routes
- post creation/status routes
- `GET /blotato/shorts/lanes`
- `POST /blotato/autoshorts/schedule`
- `POST /blotato/shorts/:lane/schedule`
- `GET /blotato/jobs/:sessionId`

Immediate-publish compatibility routes remain disabled in production unless `BLOTATO_ALLOW_IMMEDIATE_PUBLISH=true` is deliberately enabled.

## Current lanes and quality contract

The five weekday short lanes are `news-insight`, `model-verdict`, `ai-at-work`, `reality-check` and `ai-playbook`. AutoShorts rotates through 48 visual/story styles. Finished duration is 35-55 seconds with a 45-second default target.

The service checks hook strength, narrative continuity, source relevance, scene progression, human presence, caption legibility and finished media quality. It makes bounded repairs before rendering. If those repairs are exhausted, performance heuristics become advisory, while source integrity, brand safety and structural defects still block publication. The final MP4 is inspected before scheduling; technical defects always block, while a soft performance score is advisory by default and can be made strict with `BLOTATO_RENDERED_QA_BLOCK_SOFT_FAILURES=true`.

The AI Voice template receives the approved `scenes[].mediaSource` and `scenes[].script` storyboard as explicit manual inputs, plus only the template's documented voice, image-model, animation, caption, transition and aspect-ratio fields. Prompt autofill remains supplemental and cannot replace the source-grounded scenes.

Provider submission state is polled rather than assuming acceptance means publication. `BLOTATO_SCHEDULE_RECOVERY_ENABLED=true` safely moves a missed same-day slot forward while retaining the deterministic slot claim.

Production defaults require every configured channel and scheduling confirmation: `BLOTATO_REQUIRE_ALL_CHANNELS=true` and `BLOTATO_REQUIRE_SCHEDULE_CONFIRMATION=true`. The two daily renders are serialised so one render does not collide with another. A hard-QA render rejected before any social submission may be replaced once; completed or provider-submitted slots remain duplicate-protected.

The `ai-playbook` lane is prepared in the **Friday AM** operation. Friday PM is podcast-only.

## Configuration

Use the `BLOTATO_*` variables plus the shared OpenRouter/artwork settings in `config/production.defaults.env` and `env.template`. Secrets remain deployment-only.
