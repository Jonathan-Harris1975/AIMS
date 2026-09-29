# AI Edge newsletter service

**Live route prefix:** `/newsletter`

The newsletter service generates, reviews, stores and sends AI Edge through Brevo.

## HTTP contract

- `POST /newsletter/generate` — generate and QA an issue.
- `GET /newsletter/jobs/:lane/:sessionId` — inspect generation state.
- `GET /newsletter/readiness/:profileId?` — inspect sender/list/provider readiness.
- `POST /newsletter/readiness` — explicit readiness check.
- `POST /newsletter/send` — validate the prepared issue and deliver through Brevo.
- `GET /newsletter/campaigns/:campaignId/status` — inspect Brevo campaign state.

## Behaviour

Generation uses source/fact checks, Jonathan Harris voice controls, newsletter performance review and bounded correction attempts. Tuesday issues can promote the featured eBook and Thursday issues can promote Turing's Torch. Artwork receives final relevance/quality inspection.

The weekday operation windows run `generate` → `readiness` → `send`. Generation reads its own RSS feeds and stores a QA-passed issue even when Brevo is unavailable or the separate RSS rewrite task fails. A failed readiness check blocks delivery and reports the provider, sender or audience problem; a later retry can send the stored issue without regenerating it. The operation's POST readiness check creates a missing sender once to trigger Brevo verification; GET readiness only inspects. `send` repeats the provider checks before dispatch.

Production defaults currently set `AIMS_OPERATION_NEWSLETTER_ENABLED=true`. Brevo list creation is deliberately disabled with `NEWSLETTER_BREVO_ALLOW_LIST_CREATE=false`. Configure the existing AI Edge list ID (`NEWSLETTER_AI_EDGE_BREVO_LIST_ID`) and verified sender. If no ID is configured, the service can resolve a uniquely named existing list across folders; duplicate names require the ID. Actual eligible contacts are checked because Brevo is retiring some list counters and a positive count does not prove eligibility. No send occurs for a missing, ambiguous or unconfirmed audience.

Delivery records in R2 protect retries. An unavailable or malformed record blocks a retry until its state can be verified, instead of risking another campaign. The signup/consent path remains with the existing Jotform integration.

## Configuration

Use `BREVO_*`, `NEWSLETTER_*`, OpenRouter/artwork settings and the production environment templates. Secrets remain deployment-only.
