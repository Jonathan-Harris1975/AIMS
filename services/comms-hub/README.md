# AIMS Comms Hub

Comms Hub is the unified communications service inside AIMS. It is mounted at `/comms-hub` and shares the AIMS process, authentication, model routing and operational infrastructure.

## Supported channels

| Channel | Inbound | Outbound / operator actions |
|---|---|---|
| one.com `info@` email | IMAP polling and threading | governed SMTP replies |
| Jotform | verified webhook intake, fields and attachments | processed-form replies and workflow actions |
| CogniPal website chat | signed first-party intake/sync | AI replies, human takeover and callback-email capture |
| Facebook | DMs and comments | DM/comment replies and supported moderation actions |
| Instagram | DMs and comments | DM/comment replies and supported moderation actions |
| YouTube | comments | comment replies and supported moderation actions |

YouTube private DMs and live chat are outside the current adapter contract.

## Unified queue and Smart Response

Comms Hub persists channel messages and metadata in D1, exposes a filterable operator queue and keeps social `dm` and `comment` thread types explicit. AIMS-UI uses those fields to keep private messages and public comments in separate work queues.

The AI layer supports analysis, priority, response proposals, approvals, channel capability checks, idempotency, conduct/profanity controls and policy-gated autonomous responses. Unsafe, ambiguous, attachment-bearing or approval-required cases stay review-gated.

## Business-hours policy

The first substantive AIMS email response and the processed Jotform reply are scheduled **2-3 calendar days after the first inbound message**. A target falling on Saturday or Sunday rolls forward to Monday. Delivery is restricted to **Monday-Friday, 09:00-17:00 Europe/London**, and the delayed-action worker re-checks that window at execution time.

Human takeover uses the same weekday 09:00-17:00 window. Outside the window CogniPal and supported DM flows can offer optional callback-email capture instead of claiming a live hand-off is available.

Primary controls include:

- `COMMS_HUB_BUSINESS_TIMEZONE=Europe/London`
- `COMMS_HUB_BUSINESS_START_HOUR=9`
- `COMMS_HUB_BUSINESS_END_HOUR=17`
- `COMMS_HUB_EMAIL_INITIAL_REPLY_DELAY_ENABLED=true`
- `COMMS_HUB_FORM_REPLY_DELAY_ENABLED=true`
- `COMMS_HUB_REPLY_DELAY_MIN_DAYS=2`
- `COMMS_HUB_REPLY_DELAY_MAX_DAYS=3`
- `COMMS_HUB_HUMAN_HANDOFF_BUSINESS_HOURS_ONLY=true`
- `COMMS_HUB_CALLBACK_EMAIL_CAPTURE_ENABLED=true`

## Email safety

Production polls only the configured `info@jonathan-harris.online` account. Admin/newsletter mailbox automation is disabled. `COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED=false` makes the first enabled poll record the current UID watermark without importing historical message bodies. Mailbox resets/UIDVALIDITY changes re-baseline before new body fetches.

Email attachments use the same private quarantine, malware scan and clean-promotion flow as form attachments. An unsafe attachment does not silently discard its parent conversation.

## Forms and attachments

Jotform intake is verified before persistence. Attachment URLs are validated, downloaded to private R2 quarantine, scanned, integrity-checked and promoted only when clean. Public exposure is not the storage contract.

Form orchestration can route podcast and case-study submissions into content-automation editorial queues. Weekly blog, daily social-blog and podcast generation can consume those briefs.

## Podcast contribution workflow

The contribution state machine covers pre-check, asset requests/review, acceptance/rejection, episode-link recording, backlink request, optional social offer and completion. Routes exist to start and advance the workflow.

The current repository does **not** automatically advance that state machine from the successful podcast publication event. Post-publication follow-up therefore still requires workflow advancement by an operator/integration. That is the remaining end-to-end automation gap in this lane.

## Website chat

CogniPal is first-party. The website calls same-origin Pages Functions, which sign server-to-server requests into AIMS. AIMS persists the transcript and exposes sync/reply state through the Comms Hub contract. The public copy and operator flow are designed for Jonathan as a solo operator.

## Social monitoring and actions

Facebook/Instagram DMs are supported; Facebook/Instagram/YouTube comments are supported. Provider writes remain behind policy, approval, channel capability and idempotency controls. The machine-readable capability matrix is exported from `services/comms-hub/config.js` and surfaced through the social status routes.

## Main route groups

Public exact-path intake/health routes have their own verification contract. Other Comms Hub routes are AIMS-authenticated. Important operator/workflow routes include:

- conversation AI analysis and AI-status routes;
- unified queue and priority routes;
- approval and draft-send routes;
- form status/process routes;
- social status/reconciliation/action routes;
- podcast workflow start/advance routes;
- follow-up drain routes;
- chat status, reply and takeover routes;
- provider-health snapshot routes;
- backup/status/restore-validation routes.

Use the route modules under `services/comms-hub/routes/` as the exact HTTP contract rather than duplicating a long endpoint catalogue here.

## Runtime workers

The current service can run email polling, social polling, workflow evaluation, delayed actions, follow-ups, provider health and runtime supervision. Continuous polling/delayed work requires an AIMS instance to remain available; the retired public wake relay is not part of the current design.

## D1 and storage

Comms Hub migrations are additive and are applied/checkable through the existing migration tooling. The runtime D1 bridge under `workers/comms-hub-data-plane/` has a narrow authenticated SQL contract. Private attachments and workflow artefacts use the configured Comms Hub R2 lanes.

## Production controls

Use `config/production.defaults.env`, `config/comms-hub-all-channels.env.example`, `.env.example` and `services/comms-hub/config.js` as the configuration source of truth. Keep secrets in Koyeb/Cloudflare secret stores. Outreach remains separately controlled by `AIMS_OPERATION_OUTREACH_ENABLED` and is not part of Comms Hub channel activation.

Before enabling a channel, verify D1, provider credentials, webhook signatures, required account/family IDs, provider health and the relevant worker flags. Missing required live configuration should fail readiness rather than silently pretending the channel is active.
