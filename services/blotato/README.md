# Blotato service

**Live route prefix:** `/blotato`

Produces and publishes short-form video content using Blotato rendering/social APIs, AIMS-generated scripts and lane-specific visual/story rules.

## HTTP contract

Core endpoints:
- `GET /blotato/health`
- `GET /blotato/accounts` and `/accounts/:accountId/subaccounts`
- `GET /blotato/templates`
- `POST /blotato/visuals`, `GET/DELETE /blotato/visuals/:id`
- `POST /blotato/posts`, `GET /blotato/posts/:postSubmissionId`
- `GET /blotato/shorts/lanes`
- `POST /blotato/autoshorts/schedule`
- `POST /blotato/shorts/:lane/schedule`
- Legacy `publish-now` routes are disabled in production unless `BLOTATO_ALLOW_IMMEDIATE_PUBLISH=true` is deliberately set.
- `POST /blotato/shorts/news-insight`
- `POST /blotato/shorts/:lane`
- `GET /blotato/jobs/:sessionId`

## Behaviour

The quality layer checks hook strength, script length, narrative continuity, visual relevance, thumbnail text, source relationship and publish readiness. Rendering/publishing uses bounded polling and retry controls. Production publishing is scheduled-only, verifies the returned submission ID and queued `scheduled` state for every required channel, and serialises the two daily renders without blocking unrelated AIMS lanes. Friday PM uses the `ai-playbook` lane before the podcast pipeline. Configure through the `BLOTATO_*` family plus OpenRouter model variables.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
