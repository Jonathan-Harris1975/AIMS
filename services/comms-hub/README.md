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

Phase 3:

- `COMMS_HUB_AI_ENABLED=false`
- `COMMS_HUB_APPROVALS_ENFORCED=true`
- `CLOUDFLARE_AI_SEARCH_API_TOKEN`
- `COMMS_HUB_AI_SEARCH_INSTANCES`, a comma-separated allow-list
- optional AI limits and follow-up worker controls documented in `.env.example`
- routine model policy: `COMMS_HUB_MODEL_FREE_PRIMARY`, `COMMS_HUB_MODEL_FREE_BACKUP`, `COMMS_HUB_MODEL_FREE_FALLBACK`; complex-only paid policy: `COMMS_HUB_MODEL_PAID_PRIMARY`, `COMMS_HUB_MODEL_PAID_BACKUP`, `COMMS_HUB_MODEL_PAID_FALLBACK`
- privacy controls: `COMMS_HUB_OPENROUTER_ZDR_ONLY=true` and `COMMS_HUB_OPENROUTER_DATA_COLLECTION=deny`

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

Social polling, email polling, autonomous replies, follow-ups and web chat remain disabled until their corresponding test phase is explicitly opened.

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

All email, chat, wake, delayed-action, retention, autonomous-reply and credential-vault execution flags default to `false`. Deploy migration `0005` before enabling any of them. The public chat webhook is `POST /comms-hub/intake/chat`; every operator endpoint remains bearer-authenticated and additionally applies Comms Hub role permissions. The Cloudflare wake relay lives in `workers/comms-hub-wake/` and always sends `runContentJobs: false`.


## Form attachment storage

Jotform file-upload answers are persisted as attachment references with the form submission, then downloaded in the background, malware-scanned, and stored in the private Comms Hub R2 bucket. This path does **not** depend on `COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED`; the delayed-action entry remains only as a recovery path.

Required runtime settings for attachment ingestion:

- `R2_BUCKET_COMMS_HUB_PRIVATE` — private R2 bucket used for attachment objects.
- `COMMS_HUB_ATTACHMENT_SCANNER_PROVIDER=cloudmersive`
- `COMMS_HUB_ATTACHMENT_SCANNER_URL=https://api.cloudmersive.com/virus/scan/file`
- `COMMS_HUB_ATTACHMENT_SCANNER_TOKEN` (Cloudmersive API key; secret)

Stored objects are never exposed through a public R2 URL. Authenticated operators retrieve them through `GET /comms-hub/attachments/:attachmentId`, which re-validates the stored SHA-256 checksum before returning the file.
