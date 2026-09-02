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

The service checks hook strength, narrative continuity, source relevance, scene progression, human presence, caption legibility and finished media quality. The final MP4 is inspected before scheduling. Provider submission state is polled rather than assuming acceptance means publication.

Production defaults require every configured channel and scheduling confirmation: `BLOTATO_REQUIRE_ALL_CHANNELS=true` and `BLOTATO_REQUIRE_SCHEDULE_CONFIRMATION=true`. The two daily renders are serialised so one render does not collide with another.

The `ai-playbook` lane is prepared in the **Friday AM** operation. Friday PM is podcast-only.

## Configuration

Use the `BLOTATO_*` variables plus the shared OpenRouter/artwork settings in `config/production.defaults.env` and `env.template`. `BLOTATO_API_KEY` is canonical; the legacy mixed-case `Blotato_API_key` remains supported by both the client and operational preflight. Placeholder secret references are treated as unconfigured. Secrets remain deployment-only.
