# AIMS Comms Hub

Comms Hub is the unified communications service inside AIMS. It is mounted at `/comms-hub` and shares the AIMS process, authentication, model routing and operational infrastructure.

## Supported channels

| Channel | Inbound | Outbound / operator actions |
|---|---|---|
| one.com `info@` email | IMAP polling and threading | governed SMTP replies |
| Jotform | verified webhook intake, fields and attachments | processed-form replies and workflow actions |
| CogniPal website chat | signed first-party intake/sync | grounded AI replies and proactive hours-aware human takeover |
| Facebook | DMs and comments | DM/comment replies and supported moderation actions |
| Instagram | DMs and comments | DM/comment replies and supported moderation actions |
| YouTube | comments | comment replies and supported moderation actions |

YouTube private DMs and live chat are outside the current adapter contract.

## Unified queue and Smart Response

Comms Hub persists channel messages and metadata in D1, exposes a filterable operator queue and keeps social `dm` and `comment` thread types explicit. AIMS-UI uses those fields to keep private messages and public comments in separate work queues.

The AI layer supports analysis, priority, response proposals, channel capability checks, idempotency, conduct/profanity controls and policy-gated autonomous responses. Safe answerable replies auto-send on enabled channels; security, legal/privacy/money risk, repeated conduct, attachment and explicit human-review cases remain fail-closed.

## Knowledge grounding and book discovery

Comms Hub uses two complementary knowledge sources. Cloudflare AI Search (`COMMS_HUB_AI_SEARCH_INSTANCES`) grounds general website/content answers from approved indexed material. The bundled Jonathan Harris ebook catalogue is a separate first-party authoritative source for book availability and book recommendations.

Book discovery is deterministic at the final drafting step when verified catalogue candidates exist. AIMS selects from the local catalogue, records those books as first-party evidence, uses the exact canonical `jonathan-harris.online/ebooks/` URLs and does not substitute third-party titles from model memory. Broad requests such as “what books are available on artificial intelligence?” return a curated general-AI starting set; specific industry requests use scored catalogue matching. If a specific request has no verified match, the model is instructed to ask a short clarifying question rather than invent a title.

`GET /comms-hub/ai/status` exposes the approved AI Search instances, the latest AI Search diagnostics and first-party catalogue integrity/counts. AI Search provider outcomes are also recorded into the operational provider-health telemetry. This makes an indexing/token/provider problem visible instead of silently presenting a configured-but-unverified knowledge layer.

Routine Comms Hub model routing is free-first but availability-first: production defaults use Dots3-Note as the common free primary and then the paid economy safety net. Optional free backup/fallback models can still be configured explicitly, but are not enabled by default because shared free pools can be rate-limited or incompatible with the mandatory ZDR/data-collection policy.

## Business-hours policy

The first substantive AIMS email response and the processed Jotform reply are scheduled **2-3 calendar days after the first inbound message**. A target falling on Saturday or Sunday rolls forward to Monday. Delivery is restricted to **Monday-Friday, 09:00-17:00 Europe/London**, and the delayed-action worker re-checks that window at execution time.

Human takeover uses the same weekday 09:00-17:00 window. Inside the window CogniPal can proactively request a live hand-off when confidence, dissatisfaction or safety logic requires Jonathan. Outside the window CogniPal and supported DM flows direct the visitor to the verified Contact Me Jotform; conversational callback-email capture is disabled by default.

Primary controls include:

- `COMMS_HUB_BUSINESS_TIMEZONE=Europe/London`
- `COMMS_HUB_BUSINESS_START_HOUR=9`
- `COMMS_HUB_BUSINESS_END_HOUR=17`
- `COMMS_HUB_EMAIL_INITIAL_REPLY_DELAY_ENABLED=true`
- `COMMS_HUB_FORM_REPLY_DELAY_ENABLED=true`
- `COMMS_HUB_REPLY_DELAY_MIN_DAYS=2`
- `COMMS_HUB_REPLY_DELAY_MAX_DAYS=3`
- `COMMS_HUB_HUMAN_HANDOFF_BUSINESS_HOURS_ONLY=true`
- `COMMS_HUB_CALLBACK_EMAIL_CAPTURE_ENABLED=false`
- `COMMS_HUB_AUTO_SEND_ENABLED=true`
- `COMMS_HUB_AUTO_SEND_CHAT_ENABLED=true`
- `COMMS_HUB_AUTO_SEND_EMAIL_ENABLED=true`
- `COMMS_HUB_AUTO_SEND_SOCIAL_ENABLED=true`
- `COMMS_HUB_AUTO_SEND_FORM_ENABLED=true`

## Email safety

Production polls only the configured `info@jonathan-harris.online` account. Admin/newsletter mailbox automation is disabled. `COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED=false` makes the first enabled poll record the current UID watermark without importing historical message bodies. Mailbox resets/UIDVALIDITY changes re-baseline before new body fetches.

Email attachments use the same private quarantine, malware scan and clean-promotion flow as form attachments. An unsafe attachment does not silently discard its parent conversation.

## Forms and attachments

Jotform intake is verified before persistence. Attachment URLs are validated, downloaded to private R2 quarantine, scanned, integrity-checked and promoted only when clean. Public exposure is not the storage contract.

Form orchestration quality-gates verified podcast and case-study submissions before editorial reuse. Completeness is scored deterministically; coherence, narrative strength, brand fit, factual risk and best-fit lane are assessed through validated structured AI output. Only one best-fit lane is selected. Below-threshold submissions are held for review; passing submissions can route to blog, social, podcast ingestion, Blotato video or the Zernio mini-series according to enabled lanes.

All five queues have production consumers. Each consumer atomically claims a brief before generation, treats its contents as untrusted editorial direction rather than factual evidence, and releases the claim when a run fails before publication. A brief moves to `consumed` only after that lane's full publication hand-off is confirmed. Irreversible partial publications move to `reconciliation_required`, stale pending briefs expire after the configured age limit, and queue-storage errors fail closed rather than silently falling back to self-directed output. Blotato and Zernio claim one brief per short or series; the long-form blog, social-blog and podcast lanes use the general brief limit.

## Podcast contribution workflow

The contribution state machine covers pre-check, asset requests/review, acceptance/rejection, episode-link recording, backlink request, optional social offer and completion. Routes exist to start and advance the workflow.

The Friday podcast ingestion pipeline claims its editorial brief before script generation and carries the brief IDs and fingerprint through the podcast session metadata. It automatically advances accepted `podcast_contribution` workflows only after RSS publication and the website rebuild have both confirmed success. The episode URL, backlink-request state, social-post offer state and terminal completion are recorded idempotently against the publication session. If RSS is already live but the rebuild or contribution hand-off fails, the brief is held for reconciliation rather than retried as a second episode.

## Website chat

CogniPal is first-party. The website calls same-origin Pages Functions, which sign server-to-server requests into AIMS. AIMS persists the transcript and exposes sync/reply state through the Comms Hub contract. The public copy and operator flow are designed for Jonathan as a solo operator.

## Social monitoring and actions

Facebook/Instagram DMs are supported; Facebook/Instagram/YouTube comments are supported. Social polling is forward-only: the first poll establishes a freshness watermark without importing provider history, and later polls may overlap only as far back as that watermark. Per-message and per-comment timestamps are checked again before persistence, so older DMs/comments returned by a provider page are discarded. This applies to Facebook and Instagram DMs/comments and YouTube comments. Provider writes remain behind policy, approval, channel capability and idempotency controls. The machine-readable capability matrix is exported from `services/comms-hub/config.js` and surfaced through the social status routes.

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


### Restore database bootstrap

When governed backups are enabled, AIMS resolves `COMMS_HUB_RESTORE_DATABASE` (default: `COMMS_HUB_RESTORE_DATABASE`) against Cloudflare D1 and creates it when absent. `COMMS_HUB_RESTORE_DATABASE_ID` is retained only as an optional explicit UUID override. The production `D1_UUID` is never accepted as a restore target.

AI Search retrieval is fail-soft at runtime: missing/unindexed search evidence does not take the AI workflow offline. Evidence-required replies without retrieved evidence remain human-review-only. Book discovery does not depend on AI Search retrieval because verified catalogue records are injected as first-party evidence.
