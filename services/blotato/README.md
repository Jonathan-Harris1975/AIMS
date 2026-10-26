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

The service checks hook strength, narrative continuity, source relevance, scene progression, human presence, caption legibility and finished media quality. It makes bounded repairs before rendering. Rendered-video QA is recorded as an advisory audit by default so a completed paid render still reaches Blotato's scheduling endpoint. Set `BLOTATO_RENDERED_QA_BLOCK_HARD_FAILURES=true` to block model-labelled or technical hard defects, or `BLOTATO_RENDERED_QA_BLOCK_SOFT_FAILURES=true` for strict enforcement of every rendered-QA failure.

The AI Voice template receives the approved `scenes[].mediaSource` and `scenes[].script` storyboard as explicit manual inputs, plus only the template's documented voice, image-model, animation, caption, transition and aspect-ratio fields. Prompt autofill remains supplemental and cannot replace the source-grounded scenes.

Provider submission state is polled rather than assuming acceptance means publication. `BLOTATO_SCHEDULE_RECOVERY_ENABLED=true` safely moves a missed same-day slot forward while retaining the deterministic slot claim. If all RSS inputs are unavailable, scheduled short creation uses a clearly labelled evergreen editorial prompt with no fabricated source attribution.

Production defaults still require confirmation from each configured channel. If a scheduled short cannot use Blotato’s paid renderer because of a credit cap or render-service failure, AIMS creates a branded, text-led 40-second video locally from the reviewed content pack, uploads it to the public R2 media bucket, and submits it through the same channel scheduling path. This local fallback consumes no Blotato render credits. The paid-render guard remains at two per day and 100 estimated credits per month; it is never bypassed. Provider submission confirmation is still required. Actual Blotato credit use must be checked in its dashboard because AIMS receives no billing total from the rendering API.

The `ai-playbook` lane is prepared in the **Friday AM** operation. Friday PM is podcast-only.

## Configuration

Use the `BLOTATO_*` variables plus the shared OpenRouter/artwork settings in `config/production.defaults.env` and `env.template`. Secrets remain deployment-only.
