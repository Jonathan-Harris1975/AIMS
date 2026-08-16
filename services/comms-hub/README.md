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

Phase 3 is opt-in through `COMMS_HUB_AI_ENABLED=false` and remains inert until explicitly enabled. When enabled, human approval enforcement is mandatory.

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
- `COMMS_HUB_SOCIAL_MONITOR_ONLY=true` during channel canaries; polling/webhook ingestion stays live while all outbound social actions are rejected before any provider call

Phase 3:

- `COMMS_HUB_AI_ENABLED=false`
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

Mandatory AI security boundary (not feature-flagged):

- all email, social, form, website-chat and retrieved AI Search content is treated as **untrusted data**, never as model instructions; system/task instructions are structurally separated from the untrusted JSON payload
- transcript content is Unicode-normalised, common direct identifiers/credentials are redacted before inference, and detected prompt-control text is removed from the model-facing copy
- deterministic prompt-injection screening covers direct override/jailbreak wording, role-label/template injection, reserved prompt-boundary tampering, typoglycaemic obfuscation, Base64-encoded instruction payloads and remote-image/markup exfiltration attempts
- retrieved AI Search evidence is screened independently; poisoned evidence is excluded before drafting and the conversation is forced into `security_review`
- model output is validated for prompt/credential leakage, remote exfiltration markup and ungrounded external URLs
- any prompt-injection or poisoned-evidence signal forces human approval, blocks autonomous replies and suppresses automated follow-ups; high-risk provider/tool actions remain behind their existing scope-matched approval and idempotency controls
- only security fingerprints/reason codes are written to security metadata/audit records; attacker prompt text is not copied into security logs

Phase 4:

- `COMMS_HUB_PROVIDER_HEALTH_ENABLED=false`
- `COMMS_HUB_BACKUP_ENABLED=false`
- `COMMS_HUB_BACKUP_AUTOMATIC_ENABLED=false`
- `R2_BUCKET_COMMS_HUB_PRIVATE`
- `R2_BUCKET_COMMS_HUB_RESTORE`
- `COMMS_HUB_RESTORE_DATABASE_ID`, which must not equal `D1_UUID` and must point to a fresh empty database for each validation
- optional health, interval, poll and object-limit controls documented in `.env.example`

### Email first-run safety

`COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED=false` is the production-safe default. On the first enabled email poll, AIMS records the mailbox's current highest UID using metadata only and does not fetch or persist historical message bodies. Subsequent polls process only mail arriving after that watermark. Historical backfill must never be enabled during the phased Comms Hub rollout.

Social polling, email polling, autonomous replies and follow-ups remain gated by their corresponding rollout phases. Website chat is now a first-party CogniPal transport: the public website calls same-origin Cloudflare Pages Functions, those Functions HMAC-sign requests into AIMS, and AIMS persists the transcript in Comms Hub D1. `COMMS_HUB_CHAT_AI_WORKFLOW_ENABLED=false` is the safe launch setting, so the chat accepts visitor messages and human handoff without autonomous model replies. During the Meta canary, keep `COMMS_HUB_SOCIAL_MONITOR_ONLY=true` so Facebook/Instagram DMs and comments can be observed without any reply, read-state, status or moderation mutation reaching Zernio.

## Deployment order

1. Deploy the existing Comms Hub data-plane Worker and keep all new Phase 3/4 flags false.
2. Install the repository's locked production dependencies without changing `package-lock.json`.
3. Run `npm run comms:migrate:status`, then `npm run comms:migrate` to apply migrations `0003_ai_workflows`, `0004_hardening` and `0005_operations_and_channels` after the existing migrations.
4. Run the full test and build chain in the deployment environment.
5. Deploy with `COMMS_HUB_AI_ENABLED=false`, follow-up disabled, provider-health disabled and backups disabled. Verify Phase 1/2 smoke paths first.
6. Configure the approved AI Search instances and token. Enable AI with approvals enforced, then verify one low-risk draft, one high-risk approval and one unsupported moderation quarantine.
7. Enable provider-health snapshots and verify persisted status for D1, Jotform, each enabled Zernio family, AI Search and AI providers.
8. Create two private R2 buckets and a fresh disposable restore-only D1 database. Confirm all three buckets and both D1 IDs are distinct.
9. Run one manual backup through `POST /comms-hub/backups/run`, then validate it through `POST /comms-hub/backups/:backupRunId/validate` during a maintenance window.
10. Enable the follow-up worker only after its first due item has been inspected. Enable automatic backups only after the manual backup and isolated restore both succeed.

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
- `COMMS_HUB_CHAT_AI_WORKFLOW_ENABLED=false` for the initial live phase
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

The one.com email estate has three distinct addresses and roles:

- `admin@jonathan-harris.online` — service registrations and infrastructure administration. It is **not** a Comms Hub customer inbox and is not polled by the Comms Hub email worker.
- `info@jonathan-harris.online` — the primary customer-facing mailbox. This is the only mailbox enabled for live Comms Hub IMAP ingestion and SMTP replies in the current phased rollout.
- `newsletter@jonathan-harris.online` — newsletter/Brevo identity. It remains outside the normal customer-conversation poller and is reserved for the newsletter/Brevo integration.

Email rollout safeguards:

- `COMMS_HUB_EMAIL_HISTORICAL_BACKFILL_ENABLED=false`: the first live poll records only the current UID watermark and does not fetch historical message bodies.
- UIDVALIDITY changes and mailbox resets safely re-baseline before any new body fetch.
- `COMMS_HUB_EMAIL_WORKFLOW_EVALUATION_ENABLED=false`: fresh email is stored, threaded and indexed, but the later unified prompt/conversation-intelligence layer remains off.
- email attachments use the same `comms-hub-private` quarantine → malware scan → clean promotion → authenticated AIMS access path already proven by forms.
- an unsafe/unpromoted attachment does not discard its parent email.
- the live info@ mailbox password is read from `COMMS_HUB_ONECOM_PASSWORD` when supplied, otherwise from the existing `ONECOM_INFO_PASSWORD` secret.
- `ONECOM_ADMIN_PASSWORD` and `ONECOM_NEWSLETTER_PASSWORD` remain separate secrets for their own future/integration-specific use and are not used by the customer inbox worker.

### Email deployment diagnostics

Docker/Koyeb loads non-secret runtime defaults from `config/production.defaults.env`.
For the email phase that file must contain `COMMS_HUB_EMAIL_ENABLED=true` and
`COMMS_HUB_EMAIL_POLL_WORKER_ENABLED=true`; `.env.example` and `env.template`
alone do not activate production email.

The customer inbox secret is `ONECOM_INFO_PASSWORD` (or the optional
`COMMS_HUB_ONECOM_PASSWORD` override). A healthy deployment logs
`commsHub.runtime.started` with `email.enabled=true`,
`emailPollWorkerStarted=true` and `email.passwordConfigured=true`.
The first poll then logs `commsHub.emailPoll.baseline`. IMAP/auth/network
failures log `commsHub.emailPoll.failed`.


## Three-channel social monitoring profile

The production Comms Hub social contract covers all supported interaction paths for the selected channels:

| Channel | Inbound monitoring | Built outbound actions | First-rollout state |
| --- | --- | --- | --- |
| Facebook | DMs, message lifecycle events, comments | DM reply, public/private comment reply, mark-read/status, hide/unhide/delete | Monitor-only |
| Instagram | DMs, message lifecycle events, comments | DM reply, public/private comment reply, mark-read/status, hide/unhide/delete | Monitor-only |
| YouTube | Video comments | Public comment reply, delete, moderation | Monitor-only |

YouTube private DMs and YouTube live chat are outside the current Zernio Comms Hub adapter. Do not expose those controls in the operator UI. The machine-readable capability matrix is exported as `SOCIAL_CHANNEL_CAPABILITIES` from `services/comms-hub/config.js` and is returned by `GET /comms-hub/social/status`.

For a complete first canary, apply `config/comms-hub-social-monitoring.env.example`, reconcile both enabled webhook families through `POST /comms-hub/social/webhooks/reconcile-all`, and leave `COMMS_HUB_SOCIAL_MONITOR_ONLY=true` until Facebook DM/comment, Instagram DM/comment, and YouTube comment ingestion have each been proven live and deduplicated.

## Social queue contract

The unified queue now exposes `interaction_type` (`dm` or `comment`) plus social platform, family, account, provider thread/post/comment identifiers and provider status for every Zernio-backed conversation. This lets operator surfaces group private-message work separately from public comment work without guessing from subjects or message text.

