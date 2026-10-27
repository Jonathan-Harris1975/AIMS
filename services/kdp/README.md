# KDP service

The authenticated AIMS `/kdp` service exposes two subservices backed by the KDP template engine:

- `KDP_publishing` prepares titles, uploads manuscript/cover files, updates categories and publishes Kindle Direct Publishing listings.
- `KDP_audit` builds read-only reports from the D1 ebook catalogue and public Amazon product pages. An optional signed-in KDP audit collects setup metadata and price-band findings. Audit and royalty reports are stored privately.

Public audits automatically reconcile verified Kindle page-count differences to the D1 website catalogue. They do not change KDP listings; metadata and pricing changes on KDP are separate operations. Monthly Council scheduling and automatic approval of other changes are not configured here.

The optional `mode: "kdp"` audit includes a per-market Kindle eBook price-band check. It uses KDP's published 70% royalty minimum and maximum list prices, and records the rule review date and source in each report. A price below the minimum is reported with the minimum as the recommended correction. The maximum is checked when the book uses the 70% plan. Updates are not applied by the audit itself. Pricing update requests are blocked when a Kindle price is below the applicable minimum, when a 70% plan price exceeds its maximum, or when the marketplace/currency cannot be safely mapped.

The price-band rules were last checked on 2026-10-25 against KDP's [eBook List Price Requirements](https://kdp.amazon.com/en_US/help/topic/G200634560). Amazon's current values are marketplace-specific; do not convert one country's minimum into another currency. A price in range does not by itself guarantee a 70% royalty on every sale: title eligibility, buyer territory, KDP Select eligibility in some markets, VAT, delivery costs and Amazon price matching also affect royalties.

Keyword checks distinguish an empty keyword set from unused optional slots. KDP permits up to seven relevant keywords; filling all seven is not treated as a policy requirement. Short descriptions are surfaced for editorial review, not classified as a KDP policy failure based on length alone.

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
| `D1_API_KEY` | Cloudflare API token with read and write access to the KDP catalogue D1 database |
| `WEBSITE_REBUILD_HOOK`, `WEBSITE_REBUILD_HOOK_FALLBACK` | Existing private Cloudflare Pages build hooks used after a catalogue update |
| `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_PURGE_API_TOKEN` | Existing cache purge configuration used to refresh the D1 catalogue API before a build |
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
| POST | `/kdp/audit/run` | Audit every D1 ebook against its public Amazon page and persist a private report. Optional JSON: `{"marketplace":"US"}` (default) or `"UK"`. Use `{"mode":"kdp"}` for the signed-in setup metadata and price-band audit. |
| POST | `/kdp/audit/metadata/sync` | Refresh the full local/R2 metadata snapshot |
| GET | `/kdp/audit/metadata` | Read the latest metadata snapshot |
| GET | `/kdp/audit/metadata/analyze` | Analyze the latest snapshot |
| GET | `/kdp/audit/recovery/learnings` | Read browser recovery success/failure counts |
| POST | `/kdp/audit/metadata/update` and `/batch` | Preview explicit metadata changes; `dryRun` defaults to true |
| POST | `/kdp/audit/pricing/update` and `/batch` | Preview explicit pricing changes; `dryRun` defaults to true |
| GET | `/kdp/audit/reports/latest` | Read the latest private audit report |
| GET | `/kdp/audit/page-count-sync` | Read outstanding page-count and website rebuild reconciliation status |
| POST | `/kdp/audit/page-count-sync/retry` | Retry outstanding page-count reconciliation immediately |
| POST | `/kdp/audit/reports/download` | Download and store KDP royalty reports privately |
| POST | `/kdp/publishing/titles/create` | Create a KDP title draft |
| POST | `/kdp/publishing/content/upload` and `/batch` | Stage a private R2 manuscript/cover; `dryRun` defaults to true |
| POST | `/kdp/publishing/categories/update` | Set listing categories |
| POST | `/kdp/publishing/publish` | Prepare or publish a title; dry run is the default |
| POST | `/kdp/publishing/titles/unpublish`, `/delete`, `/archive` | Run corresponding KDP title actions |
| GET | `/kdp/jobs/:lane/:sessionId` | Read a long-running operation's job status |

Every live publish requires `dryRun: false`, `publish: true`, and an `X-Idempotency-Key`. Content upload and metadata/pricing updates are dry-run by default; set `dryRun: false` to apply. Deleting, archiving, and unpublishing require `confirm: true` in addition to a separate explicit request.

The default audit uses each D1 ASIN to form a marketplace-specific Amazon URL; it does not follow catalogue redirect URLs. It fetches pages sequentially, validates the page ASIN before associating data with a book, and stops fetching after an Amazon block. A report includes every D1 book even when a page is unavailable, with `publicAudit.statusCounts`, per-book status, capture time and field availability. `complete: false` means at least one page could not be captured. D1 page counts and descriptions are reported as catalogue values, separate from observed Amazon values. Public categories and prices are marketplace observations, not proof of the KDP setup selections or royalty plan. Keywords, drafts, setup fields, and KDP title IDs require the separate signed-in audit. The default audit does not discover books absent from D1 and does not reconcile the KDP account catalogue size.

For a captured Kindle ASIN, an explicitly labelled Amazon `Print length` can update a different D1 `page_count`. The service checks the ASIN, count and slug, records an intent in private R2 before writing, and uses a conditional update to protect concurrent catalogue edits. The public audit does not update from a blocked, unverified, ambiguous or missing value. Before applying updates the rebuild hook and cache purge configuration must be present. After changes it purges the ebook API cache and triggers one website build. A background worker retries pending work every five minutes and confirms the live book's ASIN, visible length and Book schema page count; an accepted build hook alone is not considered confirmation. Pending sync status is available through `/kdp/audit/page-count-sync`. Build failures, missing permissions, inaccessible Amazon pages and stale website pages remain pending for retry rather than being reported as verified. D1 write permission and the existing Cloudflare cache purge credentials are required.

Existing clients that rely on `metadataAnalysis`, `priceFloorAnalysis`, `catalogueComparison`, or `syncStats` should explicitly request `{"mode":"kdp"}`. Reports from the default mode use `publicAudit` instead.

## Service limits

- The KDP website is not a stable public API. Browser selectors and Amazon sign-in policy can change; run a low-risk session check after deployment and before enabling scheduled jobs.
- Automated login supports one SMS OTP step through TextBee. Amazon CAPTCHA, unsupported MFA challenges, or an additional verification step fail closed and require operational intervention.
- A live KDP publishing transaction has not been exercised against the account in this integration. Use dry runs, verify staged assets and metadata, then perform an initial supervised publish before enabling automated publishing.
- `KDP_audit` is ready as an on-demand endpoint and report contract. Monthly Council scheduling and automated application of audit recommendations should be connected in a follow-up after reviewing report output and change policy.
