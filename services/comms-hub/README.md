# AIMS Comms Hub

Comms Hub is service 15 inside the existing AIMS process. It is mounted at `/comms-hub`; it does not own a second server, package, Docker image or process lifecycle.

## Implemented scope

### Phase 1: verified Jotform intake

`POST /comms-hub/intake/jotform` accepts only these forms:

| Form | Jotform ID | Workflow |
|---|---:|---|
| Contact me | 260281179574362 | `contact_intake` |
| Case study | 262063136008044 | `case_study_intake` |
| Podcast enquiry | 262097861889073 | `podcast_enquiry_intake` |

Every submission is re-fetched through the Jotform API. The returned form and submission identifiers must match before the contact, conversation, message, attachment references and intake event are persisted.

Form acknowledgements/autoresponse emails remain owned by Jotform. AIMS does not send a second acknowledgement when a form is accepted. AIMS stores the verified submission in the Comms Hub data model, queues attachment ingestion when present, and writes only a redacted integrity receipt to the public Comms Hub R2 bucket. The receipt records the form route/workflow and non-sensitive counts, while the full normalised payload remains in D1.

### Phase 2: Zernio social inbox

Zernio remains the connected-channel owner, while AIMS owns ingestion, persistence, actions, polling and operational state. Meta and Video credentials are isolated; no legacy-key or cross-family fallback exists.

Implemented capabilities include verified raw-body webhooks, deterministic deduplication, Facebook and Instagram DMs/comments, YouTube comments, cursor polling, message lifecycle events, provider/account/thread identities, persistent outbound idempotency and reconciliation-required handling for uncertain side effects.

### Phase 3: AI decisions and podcast contribution workflow

In the v2.13.3 full-channel production profile, Phase 3 AI is active through `COMMS_HUB_AI_ENABLED=true`. Human approval enforcement remains mandatory and security/Smart Response gates can still block any autonomous delivery.

Implemented capabilities:

- strict-JSON intent classification and reproducible priority scoring;
- operator priority overrides with a persisted queue and audit trail;
- dedicated model routes for triage, moderation, summaries, contact replies, case-study replies, podcast replies, social replies and follow-ups;
- free-first OpenRouter routing for routine communications with an explicit primary plus two free failovers; all Comms Hub requests enforce Zero Data Retention and deny provider data collection;
- deterministic complexity escalation: paid models are eligible only for complex conversations (high priority/risk, complex intent, workflow mismatch, or large/multi-action context);
- approved Cloudflare AI Search instance allow-listing and exact evidence-reference validation;
- grounded draft generation with British English normalisation;
- immutable, scope-hashed approval requests for risky replies and moderation actions;
- sentiment, abuse and risk classification;
- platform-specific moderation capability checks that quarantine unsupported actions before any provider call;
- conversation summaries, unresolved actions and source-link retention;
- at most one idempotent follow-up for an unresolved open conversation;
- a resumable podcast contribution workflow covering pre-check, assets, review, acceptance or rejection, episode-link delivery, backlink request and social offer;
- an explicit prohibition on guest-booking paths.

The one.com adapter now provides TLS IMAP polling, MIME parsing, threaded SMTP replies, attachment handling and idempotent outbound records. It remains disabled until its mailbox credentials and execution flags are deliberately configured.

### Phase 4: provider health, backup and restore validation

Phase 4 is also opt-in. Provider health snapshots classify configured, healthy, degraded, rate-limited and unavailable routes without treating configuration as proof of liveness.

Backup and recovery use three distinct storage boundaries:

1. the live Comms Hub R2 bucket;
2. a private run-scoped backup bucket;
3. a separate restore-validation bucket.

D1 backup exports are checksummed and catalogued with table record counts. Linked private R2 objects are copied into the backup run prefix rather than merely referenced. Restore validation requires a fresh empty D1 target, imports the SQL, verifies required tables and record counts, copies archived R2 objects into the restore bucket, then re-reads and checksums them. Production database and bucket targets are rejected.

## Data and safety boundaries

- Runtime D1 traffic uses the authenticated Worker data plane; migrations and D1 export/import use Cloudflare's administrative API.
- The public `comms-hub` R2 endpoint stores redacted integrity receipts only.
- Private message archives and linked objects belong in the private backup bucket, never the public `r2.dev` bucket.
- AI Search requests are restricted to the configured instance allow-list.
- AI output is treated as untrusted input and must pass schema, evidence, policy and approval checks.
- AI analysis bounds long conversations to the newest 100 messages and 80,000 body characters before model routing.
- Completed or quarantined moderation records cannot regress to an executable state.
- Provider timeouts with uncertain side effects are not retried blindly.
- Invalid flag combinations fail readiness: follow-ups require AI, and automatic backups require the backup service.
- D1 export and import operations can block database access, so automatic backups remain disabled until a maintenance window has been approved.

## Environment contract

Base service:

- `COMMS_HUB_ENABLED`
- `D1_UUID`, `D1_API_KEY`
- `JOTFORM_API_KEY`
- existing R2 endpoint/access secrets
- `R2_BUCKET_COMMS_HUB`

Phase 2:

- `COMMS_HUB_PUBLIC_BASE_URL`
- `COMMS_HUB_D1_PROXY_URL`, `COMMS_HUB_D1_PROXY_TOKEN`
- `ZERNIO_META_API_KEY`, `ZERNIO_META_WEBHOOK_SECRET`
- `ZERNIO_VIDEO_API_KEY`, `ZERNIO_VIDEO_WEBHOOK_SECRET`
- independent `COMMS_HUB_ZERNIO_META_ENABLED` and `COMMS_HUB_ZERNIO_VIDEO_ENABLED` switches
- production v2.13.3 uses `COMMS_HUB_SOCIAL_MONITOR_ONLY=false`; `config/comms-hub-social-monitoring.env.example` remains available only for an explicit read-only canary/rollback window

Phase 3:

- `COMMS_HUB_AI_ENABLED=true` in the v2.13.3 full-channel production profile
- `COMMS_HUB_APPROVALS_ENFORCED=true`
- `CLOUDFLARE_AI_SEARCH_API_TOKEN`
- `COMMS_HUB_AI_SEARCH_INSTANCES`, a comma-separated allow-list
- optional AI limits and follow-up worker controls documented in `.env.example`
- routine model policy: `COMMS_HUB_MODEL_FREE_PRIMARY`, `COMMS_HUB_MODEL_FREE_BACKUP`, `COMMS_HUB_MODEL_FREE_FALLBACK`; complex-only paid policy: `COMMS_HUB_MODEL_PAID_PRIMARY`, `COMMS_HUB_MODEL_PAID_BACKUP`, `COMMS_HUB_MODEL_PAID_FALLBACK`
- privacy controls: `COMMS_HUB_OPENROUTER_ZDR_ONLY=true` and `COMMS_HUB_OPENROUTER_DATA_COLLECTION=deny`

Smart Conduct + Memory layer (dynamic, non-autonomous):

- `COMMS_HUB_SMART_CONTEXT_ENABLED=true` and `COMMS_HUB_SMART_CONDUCT_ENABLED=true` add deterministic conversation-scoped memory and conduct state without granting new model authority
- explicit visitor preferences (brief/detailed, links, book recommendations, follow-up) are remembered within the conversation and the latest explicit preference wins
- repeated confusion/complaint signals or an explicit human-contact request force priority review and suppress automated follow-up
- `COMMS_HUB_BAD_LANGUAGE_BLOCK_ENABLED=true` masks profanity/slurs before inference, rejects bad language in AI drafts and first-party chat replies, and prevents repeated targeted abuse/threats from reaching autonomous reply logic
- inbound abusive messages are retained for evidence; audit metadata stores only bounded conduct labels/reason codes rather than copied abusive text
- see `docs/COMMS_HUB_SMART_CONDUCT_MEMORY_V2.md` for the full policy

Live Content Awareness + Conversation Strategy layer (dynamic, non-autonomous):

- `COMMS_HUB_SMART_LIVE_CONTENT_ENABLED=true` dynamically supplies the exact social source-post context when available, recent Zernio/editorial topics and bounded public-content excerpts, plus the verified current/recent Zernio quiz state
- `COMMS_HUB_SMART_LIVE_CONTENT_MAX_ITEMS=4` bounds the number of recent public-content items supplied to a model request
- `COMMS_HUB_SMART_STRATEGY_ENABLED=true` derives a deterministic conversational objective/next-best move, response shape and promotion policy without granting provider/tool authority
- Zernio quiz question/options/answer state is now durable across restarts through R2 state hydration
- social comment polling preserves source-post title/content/permalink so public replies can respond to the actual post rather than guessing from the comment alone
- see `docs/COMMS_HUB_LIVE_CONTENT_STRATEGY_V3.md` for the full policy

Smart Response + Jotform Orchestration layer (dynamic, non-autonomous by default):

- `COMMS_HUB_SMART_RESPONSE_ENABLED=true` derives answerability, deterministic confidence, clarification/human-review needs, low-risk autonomy eligibility and the next conversational move without granting send authority
- `COMMS_HUB_FORM_ORCHESTRATION_ENABLED=true` selects only the three allow-listed Contact, Case Study and Podcast Enquiry Jotforms when structured intake is genuinely useful; ordinary questions remain conversational
- the exact approved Jotform URL is injected dynamically, while an explicit `no_links` preference causes AIMS to ask permission before exposing it
- active form requests are persisted through `sent → submitted → processed → replied` and the same active form is not repeatedly sent in one conversation
- verified returned forms are digested after the existing Jotform verification/persistence path; direct contact identifiers are kept out of the model-facing digest and attachment contents are never invented
- Jotform continues to own the immediate receipt acknowledgement; AIMS produces the later substantive processed response
- processed form replies can be delivered through the existing one.com `info@jonathan-harris.online` transport with channel idempotency; v2.13.3 uses `COMMS_HUB_FORM_AUTO_SEND_ENABLED=true`, while attachments, security/conduct risk, low confidence or approval requirements still block automatic delivery
- a selected internal Jotform hand-off is grounded by AIMS' allow-listed form registry and does not depend on unrelated AI Search evidence, while output-security/link validation remains mandatory
- podcast-segment, blog-article and newsletter-article creation from submitted information is explicitly out of scope and remains a separate downstream workflow
- see `docs/COMMS_HUB_SMART_RESPONSE_FORMS_V4.md` for the full lifecycle and controls

Mandatory AI security boundary (not feature-flagged):

- all email, social, form, website-chat and retrieved AI Search content is treated as **untrusted data**, never as model instructions; system/task instructions are structurally separated from the untrusted JSON payload
- transcript content is Unicode-normalised, common direct identifiers/credentials are redacted before inference, and detected prompt-control text is removed from the model-facing copy
- deterministic prompt-injection screening covers direct override/jailbreak wording, role-label/template injection, reserved prompt-boundary tampering, typoglycaemic obfuscation, Base64-encoded instruction payloads and remote-image/markup exfiltration attempts
- retrieved AI Search evidence is screened independently; poisoned evidence is excluded before drafting and the conversation is forced into `security_review`
- model output is validated for prompt/credential leakage, remote exfiltration markup and ungrounded external URLs
- any prompt-injection or poisoned-evidence signal forces human approval, blocks autonomous replies and suppresses automated follow-ups; high-risk provider/tool actions remain behind their existing scope-matched approval and idempotency controls
- only security fingerprints/reason codes are written to security metadata/audit records; attacker prompt text is not copied into security logs

Phase 4:

- `COMMS_HUB_PROVIDER_HEALTH_ENABLED=true` in the v2.13.3 full-channel production profile
- `COMMS_HUB_BACKUP_ENABLED=false`
- `COMMS_HUB_BACKUP_AUTOMATIC_ENABLED=false`
- `R2_BUCKET_COMMS_HUB_PRIVATE`
- `R2_BUCKET_COMMS_HUB_RESTORE`
- `COMMS_HUB_RESTORE_DATABASE_ID`, which must not equal `D1_UUID` and must point to a fresh empty database for each validation
- optional health, interval, poll and object-limit controls documented in `.env.example`

### Email first-run safety

`COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED=false` is the production-safe default. On the first enabled email poll, AIMS records the mailbox's current highest UID using metadata only and does not fetch or persist historical message bodies. Subsequent polls process only mail arriving after that watermark. Historical backfill must never be enabled during the phased Comms Hub rollout.

In v2.13.3 all completed conversation channels are active: social polling, email polling, first-party CogniPal AI workflow evaluation, follow-ups and policy-gated autonomous replies. Website chat remains a first-party CogniPal transport: the public website calls same-origin Cloudflare Pages Functions, those Functions HMAC-sign requests into AIMS, and AIMS persists the transcript in Comms Hub D1. `COMMS_HUB_CHAT_AI_WORKFLOW_ENABLED=true` and `COMMS_HUB_SOCIAL_MONITOR_ONLY=false` are the production activation settings. Security, conduct, Smart Response, approvals, capability checks, idempotency and business-hour/delay rules remain fail-closed. Outreach alone remains disabled via `AIMS_OPERATION_OUTREACH_ENABLED=false`.

## Deployment order

1. Keep `COMMS_HUB_AUTO_MIGRATE_ON_START=true` so AIMS checks and applies any pending immutable Comms Hub migrations before starting Comms Hub workers. `npm run comms:migrate` remains available for explicit maintenance.
2. Deploy AIMS v2.14.1 with the live non-secret activation profile from `config/production.defaults.env` / `config/comms-hub-all-channels.env.example` and the required production secrets supplied by the deployment environment.
3. Confirm readiness for D1, Jotform, one.com email, CogniPal HMAC, both enabled Zernio families and the approved AI Search instances. Missing required live configuration must fail readiness rather than silently disabling a channel.
4. Confirm `AIMS_OPERATION_OUTREACH_ENABLED=false`. Make.com owns the authenticated twice-daily Outreach trigger, so the internal AIMS operations scheduler must continue to skip Outreach.
5. Run the Comms Hub regression/build gates, then capture remaining live social-provider and delayed-response timing evidence without weakening security, approval, idempotency or business-hours controls.
6. Keep automatic backups disabled until the separate backup/restore maintenance-window validation is deliberately completed.

Rollback is feature-flag first: disable automatic backup, follow-up, provider health and AI, then redeploy. Migrations are additive; do not drop the new tables during an application rollback.

## Routes

Public exact-path routes:

- `GET /comms-hub/health`
- `POST /comms-hub/intake/jotform`
- `POST /comms-hub/intake/zernio/meta`
- `POST /comms-hub/intake/zernio/video`
- `POST /comms-hub/intake/chat`
- `POST /comms-hub/intake/chat/sync`

All other Comms Hub routes require AIMS bearer authentication. Phase 3/4 additions are:

- `POST /comms-hub/conversations/:conversationId/ai/analyse`
- `GET /comms-hub/conversations/:conversationId/ai`
- `GET /comms-hub/ai/status`
- `GET /comms-hub/queue`
- `POST /comms-hub/conversations/:conversationId/priority`
- `POST /comms-hub/approvals/:approvalId/decision`
- `POST /comms-hub/drafts/:draftId/send`
- `GET /comms-hub/forms/:conversationId/status`
- `POST /comms-hub/forms/:conversationId/process`
- `POST /comms-hub/social/conversations/:conversationId/approvals/:action`
- `POST /comms-hub/workflows/podcast/:conversationId/start`
- `POST /comms-hub/workflows/podcast/:conversationId/advance`
- `POST /comms-hub/follow-ups/drain`
- `GET /comms-hub/chat/status`
- `POST /comms-hub/conversations/:conversationId/chat`
- `POST /comms-hub/conversations/:conversationId/chat/takeover`
- `GET /comms-hub/providers/health`
- `POST /comms-hub/providers/health/snapshot`
- `POST /comms-hub/backups/run`
- `GET /comms-hub/backups/status`
- `POST /comms-hub/backups/:backupRunId/validate`

Outbound social actions and workflow transitions require an `Idempotency-Key` header where documented by the route. Completed identical actions return their stored result; uncertain actions are never resent automatically.

## Unified operations and remaining backend capabilities

Migration `0006_smart_response_forms` adds durable Jotform request lifecycles and verified form-processing state used by Smart Response Intelligence. Migration `0007_business_hours_and_handoff` expands delayed-action types required for scheduled first email/Jotform replies.

Migration `0005_operations_and_channels` adds the backend contracts required before the website and HIVE user-interface pass:

- a single filterable queue across forms, social, one.com email and CoginPal website chat;
- chronological email/chat threads, reviewed cross-channel identity links, assignment, statuses, tags, private notes, mentions, saved replies and bulk triage;
- private R2 attachment storage with mandatory malware scanning and checksum verification;
- standards-based IMAP/SMTP email handling with Message-ID, In-Reply-To and References preservation;
- signed CoginPal webhook intake, replay protection, idempotent replies and persistent human takeover state;
- versioned declarative workflows with executable state transitions, routing rules, delayed actions, escalations and SLA timers;
- explicit autonomous low-risk policies, disabled globally by default and still blocked for drafts requiring approval;
- encrypted credentials, allow-listed OAuth scopes and refresh-token handling;
- configurable export, anonymisation and logical deletion jobs with legal-hold tags, including private R2 object removal;
- a unified quarantine catalogue with attempt history and safe replay handlers;
- volume, response-time, resolution-time, automation, failure and channel metrics;
- role-gated API contracts for the later responsive HIVE queue and conversation workspace.

Email, wake, delayed-action, retention, autonomous-reply and credential-vault execution remain independently gated. Website chat can be enabled once migration `0005` is present and `COMMS_HUB_COGINPAL_WEBHOOK_SECRET` is configured. Public website transport uses `POST /comms-hub/intake/chat` for visitor messages and `POST /comms-hub/intake/chat/sync` for signed transcript reads; operator send/takeover endpoints remain bearer-authenticated and apply Comms Hub role permissions. The sync endpoint verifies the HMAC and timestamp but deliberately does not persist a replay nonce because it is a read-only polling operation. The Cloudflare wake relay lives in `workers/comms-hub-wake/` and always sends `runContentJobs: false`.



## First-party CogniPal website chat

The production website chat no longer depends on BotSailor. The public browser loads `/assets/js/cognipal-webchat.min.js` through the governed site script and talks only to same-origin Pages Functions. Cloudflare Pages signs each server-to-server AIMS request with `COMMS_HUB_COGINPAL_WEBHOOK_SECRET`; the secret is never exposed to the browser.

AIMS settings:

- `COMMS_HUB_CHAT_ENABLED=true`
- `COMMS_HUB_COGINPAL_WEBHOOK_SECRET=<shared secret>`
- `COMMS_HUB_CHAT_AI_WORKFLOW_ENABLED=true` in the v2.13.3 full-channel production profile
- `COMMS_HUB_CHAT_MAX_MESSAGE_CHARS=4000`
- `COMMS_HUB_CHAT_MAX_MESSAGES_PER_MINUTE=12`
- `COMMS_HUB_CHAT_HISTORY_LIMIT=100`

`COMMS_HUB_COGINPAL_API_BASE_URL` and `COMMS_HUB_COGINPAL_API_KEY` are optional compatibility settings. When they are blank, operator replies use the first-party AIMS transport: AIMS records the outbound message in D1 and the website receives it on the next signed transcript sync. If either external-provider setting is supplied, both are required.

The website Pages project needs `AIMS_COMMS_HUB_BASE_URL` plus the same `COMMS_HUB_COGINPAL_WEBHOOK_SECRET`. When the shared CogniPal secret is present, first-party chat is treated as enabled even if an older rollout left `COMMS_HUB_CHAT_ENABLED=false`; use `COMMS_HUB_CHAT_FORCE_DISABLED=true` only as the explicit emergency kill switch. Leave `COMMS_HUB_COGINPAL_API_BASE_URL` and `COMMS_HUB_COGINPAL_API_KEY` blank for first-party website transport. Keep the shared secret in Koyeb/Cloudflare secrets rather than in either repository. Visitor messages are length-limited and rate-limited server-side, transcript reads are visitor/session-bound, and requests with a mismatched visitor ID are rejected. Human handoff uses persistent `takeover_requested`, `human`, `automation` and `closed` session states.

## Form attachment storage

Jotform file-upload answers are persisted as attachment references with the form submission, then downloaded in the background, malware-scanned, and stored in the private Comms Hub R2 bucket. This path does **not** depend on `COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED`; the delayed-action entry remains only as a recovery path.

Required runtime settings for attachment ingestion:

- `R2_BUCKET_COMMS_HUB_PRIVATE` — private R2 bucket used for attachment objects.
- `COMMS_HUB_ATTACHMENT_SCANNER_PROVIDER=cloudmersive`
- `COMMS_HUB_ATTACHMENT_SCANNER_URL=https://api.cloudmersive.com/virus/scan/file`
- `COMMS_HUB_ATTACHMENT_SCANNER_TOKEN` (Cloudmersive API key; secret)

Stored objects are never exposed through a public R2 URL. Authenticated operators retrieve them through `GET /comms-hub/attachments/:attachmentId`, which re-validates the stored SHA-256 checksum before returning the file.


### R2 privacy transition

Primary Comms Hub R2 access is authenticated. `comms-hub` and `comms-hub-private` are private buckets; `R2_PUBLIC_BASE_URL_COMMS_HUB` must remain blank and any bucket public development URL/custom public domain should be disabled in Cloudflare. The backup/restore bucket has not been created and must remain disabled until that phase is intentionally implemented.


## Live email rollout configuration

The one.com email estate has three distinct Comms Hub mailbox services:

- `info@jonathan-harris.online` — the primary customer-facing Smart/automated mailbox.
- `admin@jonathan-harris.online` — an independently polled operator mailbox surfaced under Unified Inbox → Admin email. It is manual-reply-only.
- `newsletter@jonathan-harris.online` — an independently polled operator mailbox surfaced under Unified Inbox → Newsletter email. It is manual-reply-only and remains distinct from the newsletter content-generation service.

Email rollout safeguards:

- `COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED=false`: the first live poll records only the current UID watermark and does not fetch historical message bodies.
- UIDVALIDITY changes and mailbox resets safely re-baseline before any new body fetch.
- `COMMS_HUB_EMAIL_WORKFLOW_EVALUATION_ENABLED=true`: fresh email is stored, threaded, indexed and evaluated by the Smart Layers; attachment-bearing or unsafe/ambiguous messages remain review-gated.
- email attachments use the same `comms-hub-private` quarantine → malware scan → clean promotion → authenticated AIMS access path already proven by forms.
- an unsafe/unpromoted attachment does not discard its parent email.
- the live info@ mailbox password is read from `COMMS_HUB_ONECOM_PASSWORD` when supplied, otherwise from the existing `ONECOM_INFO_PASSWORD` secret.
- `ONECOM_ADMIN_PASSWORD` and `ONECOM_NEWSLETTER_PASSWORD` are separate one.com mailbox secrets. When the corresponding mailbox flags are enabled, Comms Hub polls `admin@jonathan-harris.online` and `newsletter@jonathan-harris.online` independently. Those two inboxes are manual-reply-only: inbound messages are stored/indexed normally but do not trigger the email Smart/automation workflow.

### Email deployment diagnostics

Docker/Koyeb loads non-secret runtime defaults from `config/production.defaults.env`.
For the email phase that file must contain `COMMS_HUB_EMAIL_ENABLED=true` and
`COMMS_HUB_EMAIL_POLL_WORKER_ENABLED=true`; `.env.example` and `env.template`
alone do not activate production email.

The customer inbox secret is `ONECOM_INFO_PASSWORD` (or the optional
`COMMS_HUB_ONECOM_PASSWORD` override). Admin and Newsletter use
`ONECOM_ADMIN_PASSWORD` and `ONECOM_NEWSLETTER_PASSWORD`. A healthy deployment logs
`commsHub.runtime.started` with `email.enabled=true` and an `email.accounts` map for
`info`, `admin` and `newsletter`, including each account's `workerStarted`,
`manualOnly` and `passwordConfigured` state. `emailPollWorkerStarted` is likewise a
per-account map. Each mailbox establishes its own `commsHub.emailPoll.baseline`;
IMAP/auth/network failures log `commsHub.emailPoll.failed` with the account key.


## Three-channel social monitoring profile

The production Comms Hub social contract covers all supported interaction paths for the selected channels:

| Channel | Inbound monitoring | Built outbound actions | Production state |
| --- | --- | --- | --- |
| Facebook | DMs, message lifecycle events, comments | DM reply, public/private comment reply, mark-read/status, hide/unhide/delete | Active; writes policy-gated |
| Instagram | DMs, message lifecycle events, comments | DM reply, public/private comment reply, mark-read/status, hide/unhide/delete | Active; writes policy-gated |
| YouTube | Video comments | Public comment reply, delete, moderation | Active; writes policy-gated |

YouTube private DMs and YouTube live chat are outside the current Zernio Comms Hub adapter. Do not expose those controls in the operator UI. The machine-readable capability matrix is exported as `SOCIAL_CHANNEL_CAPABILITIES` from `services/comms-hub/config.js` and is returned by `GET /comms-hub/social/status`.

Production v2.13.3 runs with `COMMS_HUB_SOCIAL_MONITOR_ONLY=false`. `config/comms-hub-social-monitoring.env.example` is retained as an explicit read-only canary/rollback profile. Live Facebook/Instagram/YouTube canaries should still be captured as evidence and rollback confidence checks; they are no longer the configuration unlock for the channel.

## Social queue contract

The unified queue now exposes `interaction_type` (`dm` or `comment`) plus social platform, family, account, provider thread/post/comment identifiers and provider status for every Zernio-backed conversation. This lets operator surfaces group private-message work separately from public comment work without guessing from subjects or message text.


## Pre-Outreach conversation acceptance close-out (v2.13.1)

Before Outreach setup, the Comms Hub conversation paths are sanity-checked as one system rather than independent adapters. The close-out covers CogniPal chat, one.com email, Facebook/Instagram DMs, Facebook/Instagram/YouTube comments, all three approved Jotforms, form processing/reply, attachments, handoff, reply-state safety, social channel-family policy matching and the Smart Layer security stack. See `docs/COMMS_HUB_PRE_OUTREACH_SANITY_V2.13.1.md` for the acceptance matrix and the remaining live-provider caveats.


## Business-hours replies and human contact (v2.13.2)

AIMS applies a hard UK business-hours policy before Outreach is enabled. The first substantive AIMS email response and the later processed Jotform response are scheduled 2-3 calendar days after the first inbound message. If that target date is Saturday or Sunday it rolls forward to Monday. Delivery is allowed only Monday-Friday between 09:00 and 17:00 in `Europe/London`, with DST handled by the runtime timezone conversion. The delayed-action worker re-checks the window at execution time, so a late worker wake-up cannot send an overdue reply during the evening or weekend. Jotform's own immediate receipt acknowledgement remains Jotform-owned and is not delayed by AIMS.

Human hand-off is also a hard Monday-Friday 09:00-17:00 UK-time boundary. CogniPal cannot enter `takeover_requested` or `human` outside that window, even through an authenticated operator takeover call. Outside the window it offers the visitor an optional callback-email path instead. Facebook and Instagram DM human-contact requests use the same availability calculation; when outbound social writes are enabled, the deterministic DM offers live hand-off only in-hours and otherwise offers the callback-email route. YouTube has no DM lane. Callback email capture is consent-based, conversation-scoped and stored as an unverified `callback_email` alias, so it does not silently merge identities or satisfy verified-email/Jotform linkage.

The primary rollout controls are:

- `COMMS_HUB_BUSINESS_TIMEZONE=Europe/London`
- `COMMS_HUB_BUSINESS_START_HOUR=9`
- `COMMS_HUB_BUSINESS_END_HOUR=17`
- `COMMS_HUB_EMAIL_INITIAL_REPLY_DELAY_ENABLED=true`
- `COMMS_HUB_FORM_REPLY_DELAY_ENABLED=true`
- `COMMS_HUB_REPLY_DELAY_MIN_DAYS=2`
- `COMMS_HUB_REPLY_DELAY_MAX_DAYS=3`
- `COMMS_HUB_HUMAN_HANDOFF_BUSINESS_HOURS_ONLY=true` (fail-closed; `false` is rejected)
- `COMMS_HUB_CALLBACK_EMAIL_CAPTURE_ENABLED=true`
- `COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED=true`

Migration `0007_business_hours_and_handoff` expands the delayed-action schema for `reply_draft`, `email_reply` and `form_reply`; deploy/apply it before relying on scheduled business-hour responses. The direct website request to the first-party CogniPal intake is itself what wakes a sleeping Koyeb AIMS instance. The old signed wake relay is retired. Continuous IMAP, social-poll, delayed-action and follow-up automation therefore requires the AIMS Koyeb service to keep at least one instance running. See `docs/COMMS_HUB_BUSINESS_HOURS_HANDOFF_V2.13.2.md` and `docs/COMMS_HUB_RUNTIME_RELIABILITY_V2.14.1.md`.


## Full-channel production activation (v2.13.3)

The production defaults now activate all completed conversation channels: Jotform/forms, the live `info@` mailbox, CogniPal website chat, Facebook/Instagram DMs and Facebook/Instagram/YouTube comments. Meta/Video polling, Smart Layers, AI workflow evaluation, low-risk form auto-send, provider health and the autonomous reply engine are enabled. `COMMS_HUB_SOCIAL_MONITOR_ONLY=false` permits provider delivery, but replies remain fail-closed behind Smart Response eligibility, prompt/conduct security, approval requirements, active autonomous policies, idempotency and channel-specific delivery rules.

Migration `0008_full_channel_activation` creates conservative active policies for low-risk/high-confidence chat, email and social replies. Fresh attachment-free email and inbound social messages now kick the Smart Layer analysis path automatically; attachment-bearing messages stay review-gated instead of being blindly auto-answered. Email and processed Jotform substantive replies continue to schedule 2-3 calendar days after receipt, weekdays only between 09:00-17:00 Europe/London. Human hand-off remains restricted to that same weekday business window. Historical email backfill and arbitrary external email recipients remain disabled.

Outreach automation is implemented, but the internal AIMS operations scheduler remains deliberately excluded. `AIMS_OPERATION_OUTREACH_ENABLED=false` prevents duplicate Outreach runs while Make.com owns the authenticated twice-daily `/outreach/batch/next` trigger.

AIMS now self-heals pending Comms Hub schema migrations at runtime startup when `COMMS_HUB_AUTO_MIGRATE_ON_START=true`. `npm run comms:migrate` remains available as an explicit maintenance command. `config/comms-hub-all-channels.env.example` documents the non-secret activation profile.


## Runtime reliability and restored Outreach lineage (v2.14.1)

AIMS v2.14.1 consolidates the full v2.14.0 guest-article Outreach automation with the later Admin/Newsletter multi-mailbox work, automatic D1 schema recovery and environment-sanity changes. Migration `0009_outreach_automation` is restored and `0010_runtime_reliability` adds a narrow low-risk `social_engagement` autonomous policy while retaining the evidence-required general social policy.

The social polling worker now passes the complete runtime context into polled-event persistence, so polling has the same attachment, human-contact and AI/governance automation capabilities as webhook intake. Enabled Zernio webhooks are reconciled at startup and periodically, and a bounded runtime supervisor retries recoverable Comms Hub startup/schema failures. HIVE should use AIMS `/readyz` for operational monitoring rather than a service-specific liveness endpoint.

The obsolete wake relay has been removed. Keep at least one AIMS Koyeb instance running for continuous background polling and delayed-action workers. Full operational notes are in `docs/COMMS_HUB_RUNTIME_RELIABILITY_V2.14.1.md`.
