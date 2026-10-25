# KDP service

The authenticated AIMS `/kdp` service exposes two subservices backed by the KDP template engine:

- `KDP_publishing` prepares titles, uploads manuscript/cover files, updates categories and publishes Kindle Direct Publishing listings.
- `KDP_audit` synchronizes KDP listing metadata, analyzes metadata, compares Amazon listings with the website's D1 ebook catalogue, and saves private audit and royalty reports.

Audit runs are read-only. The audit can identify listing issues and return a report for the Council workflow; metadata and pricing changes are separate explicit operations. Monthly Council scheduling and automatic approval of changes are not configured here.

## Runtime and secrets

Set these Koyeb environment variables/secrets:

| Variable | Purpose |
|---|---|
| `KDP_USERNAME` | Amazon/KDP account username (Koyeb secret) |
| `KDP_PASSWORD` | Amazon/KDP account password (Koyeb secret) |
| `KDP_OTP_ALLOWED_SENDERS` | Comma-separated allow-list of Amazon SMS sender values observed in TextBee |
| `KDP_OTP_CHALLENGE_TIMEOUT_MS` | Optional OTP timeout; defaults to 180 seconds |
| `KDP_D1_DATABASE_ID` | Website ebook catalogue D1 ID; defaults to the existing KDP catalogue database |
| `KDP_CONTENT_MAX_BYTES` | Optional maximum staged manuscript/cover size; defaults to 200 MiB |
| `R2_BUCKET_KDP` | Private R2 bucket name; set to `kdp` |
| `D1_API_KEY` | Cloudflare API token with read access to the KDP catalogue D1 database |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Existing AIMS R2 credentials, scoped to the private bucket |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Optional Chromium executable override; defaults to `/usr/bin/chromium` |

The KDP service reads ebook records from the website catalogue's `ebooks` table. Manuscript objects are resolved by their catalogue R2 key and must be private PDF files under `Manuscripts pdf format/`. The service stages them in a private temporary directory, removes them after the operation, and stores metadata snapshots, audit reports, royalty workbooks, and publish references in the private `kdp` R2 bucket. It does not create public URLs.

The production image must install Chromium and run a Node 24.22+ runtime. Browser login state is stored under `KDP_SESSION_DIR` (default: the container temporary directory) with restrictive file permissions. It is ephemeral across instance replacement; KDP automatically signs in again when needed.

## OTP handoff

TextBee's public callback is hosted by HIVE-UI at:

`https://hive.jonathan-harris.online/webhooks/textbee/kdp-otp`

Configure TextBee to send `MESSAGE_RECEIVED` events and set a signing secret of at least 20 characters as HIVE-UI's `TEXTBEE_WEBHOOK_SECRET`. Configure HIVE-UI's `AIMS_ADMIN_TOKEN` with the AIMS `AIMS_API_KEY` value. HIVE-UI verifies the TextBee HMAC over raw request bytes before forwarding an event to the bearer-authenticated AIMS route `POST /kdp/otp/textbee`.

OTP messages and codes are never logged or persisted. The broker is process-local with one active challenge, so run one AIMS replica and serialize KDP writes. Move the broker to shared, TTL-capable state with atomic one-use delivery before scaling to multiple replicas.

## Routes

All routes require the normal AIMS bearer authentication. Long-running browser operations return a job and status URL; poll that URL until the job is finished.

| Method | Route | Purpose |
|---|---|---|
| GET | `/kdp/status` | Safe service status and readiness checks |
| GET | `/kdp/readiness` | Deployment prerequisite checks |
| POST | `/kdp/session/connect` | Sign in and validate the KDP session |
| GET | `/kdp/session/status` | Check session state without exposing cookies |
| DELETE | `/kdp/session` | Disconnect and remove the local browser session/cache |
| POST | `/kdp/otp/textbee` | Internal OTP event handoff from HIVE-UI |
| POST | `/kdp/audit/run` | Sync listings, analyze metadata, compare with D1, and persist a private report |
| POST | `/kdp/audit/metadata/sync` | Refresh the full local/R2 metadata snapshot |
| GET | `/kdp/audit/metadata` | Read the latest metadata snapshot |
| GET | `/kdp/audit/metadata/analyze` | Analyze the latest snapshot |
| GET | `/kdp/audit/recovery/learnings` | Read browser recovery success/failure counts |
| POST | `/kdp/audit/metadata/update` and `/batch` | Preview explicit metadata changes; `dryRun` defaults to true |
| POST | `/kdp/audit/pricing/update` and `/batch` | Preview explicit pricing changes; `dryRun` defaults to true |
| GET | `/kdp/audit/reports/latest` | Read the latest private audit report |
| POST | `/kdp/audit/reports/download` | Download and store KDP royalty reports privately |
| POST | `/kdp/publishing/titles/create` | Create a KDP title draft |
| POST | `/kdp/publishing/content/upload` and `/batch` | Stage a private R2 manuscript/cover; `dryRun` defaults to true |
| POST | `/kdp/publishing/categories/update` | Set listing categories |
| POST | `/kdp/publishing/publish` | Prepare or publish a title; dry run is the default |
| POST | `/kdp/publishing/titles/unpublish`, `/delete`, `/archive` | Run corresponding KDP title actions |
| GET | `/kdp/jobs/:lane/:sessionId` | Read a long-running operation's job status |

Every live publish requires `dryRun: false`, `publish: true`, and an `X-Idempotency-Key`. Content upload and metadata/pricing updates are dry-run by default; set `dryRun: false` to apply. Deleting, archiving, and unpublishing require `confirm: true` in addition to a separate explicit request.

## Service limits

- The KDP website is not a stable public API. Browser selectors and Amazon sign-in policy can change; run a low-risk session check after deployment and before enabling scheduled jobs.
- Automated login supports one SMS OTP step through TextBee. Amazon CAPTCHA, unsupported MFA challenges, or an additional verification step fail closed and require operational intervention.
- A live KDP publishing transaction has not been exercised against the account in this integration. Use dry runs, verify staged assets and metadata, then perform an initial supervised publish before enabling automated publishing.
- `KDP_audit` is ready as an on-demand endpoint and report contract. Monthly Council scheduling and automated application of audit recommendations should be connected in a follow-up after reviewing report output and change policy.
