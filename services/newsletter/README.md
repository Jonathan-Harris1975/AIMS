# AI Edge newsletter service

**Live route prefix:** `/newsletter`

The newsletter service generates, reviews, stores and sends AI Edge through Brevo.

## HTTP contract

- `POST /newsletter/generate` — generate and QA an issue.
- `GET /newsletter/jobs/:lane/:sessionId` — inspect generation state.
- `GET /newsletter/readiness/:profileId?` — inspect sender/list/provider readiness.
- `POST /newsletter/readiness` — explicit readiness check.
- `POST /newsletter/send` — validate the prepared issue and deliver through the existing AIMS one.com newsletter sender.
- `GET /newsletter/campaigns/:campaignId/status` — inspect Brevo campaign state.

## Behaviour

Generation uses source/fact checks, Jonathan Harris voice controls, newsletter performance review and bounded correction attempts. Tuesday issues can promote the featured eBook and Thursday issues can promote Turing's Torch. Artwork receives final relevance/quality inspection.

The weekday operation windows run `generate` → `readiness` → `send`. Generation reads its own RSS feeds and stores a QA-passed issue even when Brevo is unavailable or the separate RSS rewrite task fails. A failed readiness check blocks delivery and reports the provider, sender or audience problem; a later retry can send the stored issue without regenerating it. The operation's POST readiness check creates a missing sender once to trigger Brevo verification; GET readiness only inspects. `send` repeats the provider checks before dispatch.

Production defaults currently set `AIMS_OPERATION_NEWSLETTER_ENABLED=true`. Audience, consent, verification and suppression state are stored in the existing AIMS D1 database. Only double-opted-in, active and non-suppressed subscribers are eligible for delivery. The existing one.com newsletter mailbox performs delivery.

Delivery records in R2 protect retries. An unavailable or malformed record blocks a retry until its state can be verified, instead of risking another campaign. The signup/consent path remains with the existing Jotform integration.

## Configuration

Use `NEWSLETTER_*`, the existing AIMS D1/Comms Hub settings, the one.com newsletter mailbox, OpenRouter/artwork settings and the production environment templates. Secrets remain deployment-only.
