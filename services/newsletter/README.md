# AI Edge newsletter service

**Live route prefix:** `/newsletter`

Generates, reviews, stores and sends AI Edge through Brevo. The editorial format prioritises a small number of important stories, Jonathan Harris analysis, useful tools/workflows, radar items, a reality-check section and cross-channel promotion.

## HTTP contract

- `POST /newsletter/generate` — build and QA an issue.
- `GET /newsletter/jobs/:lane/:sessionId` — inspect generation job state.
- `POST /newsletter/send` — deliver a previously generated QA-passed issue through Brevo.
- `GET /newsletter/campaigns/:campaignId/status` — query Brevo campaign state.

## Behaviour

Generation uses a specialist council covering source/fact integrity, Jonathan voice, newsletter/audience performance and a final chair. The service enforces a minimum QA pass count and bounded correction attempts. Tuesday issues can promote the featured ebook; Thursday issues can promote Turing's Torch. Delivery finds or creates the configured Brevo list/folder and requires a valid sender. Operational execution is controlled by `AIMS_OPERATION_NEWSLETTER_ENABLED`. Key variables: `BREVO_*`, `NEWSLETTER_*`, sender/list/profile settings and OpenRouter council/editorial model settings.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
