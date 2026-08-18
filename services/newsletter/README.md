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

The weekday operation windows run `generate` and then `send`. `send` performs the required provider/list/sender checks itself, so the standalone readiness endpoint is diagnostic rather than a compulsory third task in the operation sequence.

Production defaults currently set `AIMS_OPERATION_NEWSLETTER_ENABLED=true`. Brevo list creation is deliberately disabled with `NEWSLETTER_BREVO_ALLOW_LIST_CREATE=false`; configure the existing AI Edge list ID/name and verified sender instead of relying on runtime list creation.

## Configuration

Use `BREVO_*`, `NEWSLETTER_*`, OpenRouter/artwork settings and the production environment templates. Secrets remain deployment-only.
