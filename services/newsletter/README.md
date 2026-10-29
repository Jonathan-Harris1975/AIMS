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

AI Edge is an email-only daily briefing, currently Monday to Friday. Each issue has one email-safe `email.html` artefact, plus plaintext for email clients and metadata for delivery/audits. No website archive is generated or site shell fetched. Existing delivery/session receipts remain authoritative.

The opening introduces the selected stories in that day's edition; weekly edition framing is rejected before sending. The issue ends after Reality Check and any scheduled house promotion, without a generic reader-question closer.

Hero art follows the editorially selected lead and its source summary. Decorative geometry is a hard visual-QA failure, shortened prompts are disabled by default for newsletters, and diagnostic fallback art is never publishable. Changes to this editorial policy invalidate older build checkpoints.

Generation uses source/fact checks, Jonathan Harris voice controls, newsletter performance review and bounded correction attempts. Tuesday issues can promote the featured eBook and Thursday issues can promote Turing's Torch. Artwork receives final relevance/quality inspection.

The weekday operation windows run `generate` → `readiness` → `send`. Generation reads its own RSS feeds and stores a QA-passed issue even when Brevo is unavailable or the separate RSS rewrite task fails. A failed readiness check blocks delivery and reports the provider, sender or audience problem; a later retry can send the stored issue without regenerating it. The operation's POST readiness check creates a missing sender once to trigger Brevo verification; GET readiness only inspects. `send` repeats the provider checks before dispatch.

Production defaults currently set `AIMS_OPERATION_NEWSLETTER_ENABLED=true`. Audience, consent, verification and suppression state are stored in the existing AIMS D1 database. Only double-opted-in, active and non-suppressed subscribers are eligible for delivery. The existing one.com newsletter mailbox performs delivery.

Delivery records in R2 protect retries. An unavailable or malformed record blocks a retry until its state can be verified, instead of risking another campaign. The signup/consent path remains with the existing Jotform integration.

## Configuration

Use `NEWSLETTER_*`, the existing AIMS D1/Comms Hub settings, the one.com newsletter mailbox, OpenRouter/artwork settings and the production environment templates. Secrets remain deployment-only.

## Recovery behaviour

Malformed or unavailable reviews are review-service failures, not editorial defects: they never trigger copy rewrites. Council requests settle independently; completed reviews and individual seat errors remain in the result. Incomplete councils still block publication. Reviews use portable JSON instructions with locally validated score, verdict, blocking flag and issue types, plus concise response instructions and adequate output space. Existing quality thresholds and repair limits remain unchanged.

After editorial approval, a private daily checkpoint retains the approved draft, selected sources and review result. A retry on the same UTC date and unchanged profile/model/threshold policy resumes artwork/render/storage; it does not repeat editorial generation. A validated hero is checkpointed before rendering too. Resumption retains the original issue session ID so existing email delivery receipts remain authoritative. Missing or invalid checkpoints fall back to the full normal build. No failed draft can become a checkpoint approval. Existing delivery receipts still control email retries. Schedules remain owned by MAST.
