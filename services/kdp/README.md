# KDP service

The authenticated AIMS `/kdp` service exposes two subservices backed by the KDP template engine:

- `KDP_publishing` prepares titles, uploads manuscript/cover files, updates categories and publishes Kindle Direct Publishing listings.
- `KDP_audit` builds read-only reports from the D1 ebook catalogue and public Amazon product pages. An optional signed-in KDP audit collects setup metadata and price-band findings. Audit and royalty reports are stored privately.

Public audits automatically reconcile verified Kindle page-count differences to the D1 website catalogue. They do not change KDP listings; metadata and pricing changes on KDP are separate operations. Monthly Council scheduling and automatic approval of other changes are not configured here.

The MAST-triggered weekly research job searches for candidate Kindle competitors in the US and UK and recent topic sources. It requires a complete Monday public audit started between 12:00 and 15:00 Europe/London and runs Tuesday–Thursday in the same window. With `TAVILY_SEARCH_API` and durable R2 state configured, it selects a rotating batch (default 15), makes four Tavily basic searches per book, and checkpoints after each book. It processes at most one book per minute; unfinished work resumes in the next available window. `/kdp/research/weekly` returns the current private state; completed and carried-over research is archived under `research/weekly/` in the private KDP bucket. MAST triggers the Monday audit and the Tuesday–Thursday research runs.

Search results are leads only, not verified Kindle prices, comparable-title assessments, validated trends, or proof that the book covers a topic. The worker never writes KDP, D1, or the website. The update pipeline, source verification and LLM evaluation remain separate work. The preliminary pricing helper requires independently verified comparable records. UK candidate prices have a £6.43 baseline, and the live optimisation process applies a higher file-size-aware royalty floor. US candidates retain a $4.99 default. The weekly workflow has separate evidence and update stages.

The research job also attempts to capture up to five candidate product pages per market. It records page identity, title, description, page count, price and whether the price came from an explicit Kindle element. Comparability and promotion status remain unknown. If Amazon blocks a request, the job stops and preserves the search leads for a later retry without spending additional search credits.

When a fresh signed-in metadata snapshot uniquely matches the catalogue ASIN, an ASIN-verified live product page was captured in the Monday audit, and dated topic sources exist, the research job can create a first-pass optimisation draft using the configured free OpenRouter model. It filters keywords against the live listing and source snippets and only retains description sentences already present on the live listing. The draft is recorded in the research result and is not submitted to KDP. Price changes remain blocked until comparability and promotion status can be verified. Missing identity, dated sources or model availability is recorded as a blocked reason.

The optional `mode: "kdp"` audit includes a per-market Kindle eBook price-band check and reports its rule review date and source. For UK Kindle prices it also checks the commercial floor needed to yield at least £4.50 on an eligible 70% royalty sale, after Amazon's file-size-dependent delivery cost. Signed-in KDP file size and 70% plan verification are required; otherwise the audit reports that the target is unverified. A price below a minimum is reported with the correction, while a price above a 70% band maximum is flagged. The audit never changes prices. UK pricing updates fail closed when the royalty plan, delivery size or price is insufficient.

The price-band rules were checked on 2026-11-12 against KDP's [eBook List Price Requirements](https://kdp.amazon.com/en_US/help/topic/G200634560) and [Digital Book Pricing](https://kdp.amazon.com/en_US/help/topic/G200634500). The UK delivery rate is £0.10/MB and UK eBook VAT is currently zero. For example, a verified 1 MB delivery file requires £6.53 list price, and 5 MB requires £6.93, for an estimated £4.50 royalty. Do not confuse the commercial floor with Amazon's much lower legal 70% price-band minimum of £1.77. The target concerns eligible UK sales at the standard list price only: 35% territories, price matching, promotions, refunds, tax changes and exchange rates can reduce the realised payout. Other marketplaces are not automatically converted from GBP.

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
| `TAVILY_SEARCH_API` | Tavily Search API token; when configured, enables MAST-triggered weekly research (four searches per selected book) |
| `KDP_RESEARCH_BATCH_SIZE` | Number of ebooks per weekly research batch, 1–100; defaults to 15 |
| `KDP_RESEARCH_MONTHLY_SEARCH_LIMIT` | Maximum Tavily calls by this service per London calendar month, at most 1000; defaults to 900 |
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
| POST | `/kdp/research/weekly/run` | Start a resumable MAST-triggered weekly research batch |
| GET | `/kdp/research/weekly` | Read the current weekly research state and unverified sources |
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

## Weekly optimisation and rollout

MAST remains the sole clock: public D1/ASIN listing audit Monday 12:00 London,
setup metadata refresh Monday 12:15, rotating research batches Tuesday–Thursday
12:00. `KDP_RESEARCH_BATCH_SIZE` defaults to 15. Each research tick processes one
book, and pauses five minutes before continuing. The research never substitutes
KDP search results for the public audit.

Research combines captured Amazon recommendations with Tavily candidates and
recent dated sources. A free-only drafter and separate critic use
`kdpResearchDraft` with no application retries. Both must accept the evidence;
there is no paid fallback. Competitor private keyword fields are not available.
Public wording informs suggestions, and every accepted keyword requires book and
source quotes. Proposed descriptions require supporting quotes for every sentence.
Two distinct source domains are required; a news mention is not search-volume data.

Prices target comparable medians with average prices retained in the evidence.
`KDP_RESEARCH_PRICE_FLOOR_USD_MINOR` defaults to 499 and
`KDP_RESEARCH_PRICE_FLOOR_GBP_MINOR` defaults to 643, both in pennies/cents;
the UK effective minimum is always the greater of its configured floor and
`ceil(£4.50 / 0.70)` plus verified KDP delivery cost. Existing lower GBP
environment overrides cannot defeat that rule. When signed-in delivery size or
70% plan cannot be verified, UK price changes are blocked rather than guessed.
At least three fresh unique Kindle comparisons are needed, with explicit local currency and no visible promotion.
This means **no promotion was visible**, not proof that the competitor has never
been discounted. Changes over 25% are withheld, and confirmed prices have a
28-day cooldown. Royalty-band validation is reused from the KDP engine.

Private R2 `research/updates/<week>/<ebookId>.json` records preserve proposals,
previous D1/KDP values, submission state and confirmation. Prepared records expire
after 48 hours. A crash or timeout after entering `submitting` never automatically
replays Publish. Verification checks fresh signed-in identity, Live status and
keywords, then both UK/US public listings. Unconfirmed submissions require attention
after five days. `KDP_UPDATE_DELAY_MINUTES` defaults to five (minimum five).

MAST calls `POST /kdp/research/updates/run` daily at 12:05, 13:05, 14:05, 16:05
and 20:05 London. Submission remains Tuesday–Thursday 12:00–15:00; the later
calls only reconcile. Publication checks are spaced at least four hours apart.
Existing authenticated service middleware protects the routes.

Confirmed descriptions and keywords use compare-and-swap D1 writes, then the
existing cache purge and website rebuild hooks. Website confirmation checks the
ASIN and description. Prices are retained in the private ledger: no unverified
D1 price columns or website price fields are assumed. This change does not alter
other-marketplace manual/automatic conversion settings in KDP.

Deploy AIMS before enabling its companion MAST schedules. Production acceptance
still requires a fresh signed-in snapshot with unique ASIN associations, a live
Tavily/free-model request, configured D1 write/cache-purge/rebuild credentials,
and one confirmed KDP-to-website update. Local mocks and CI do not establish those
production facts. Inspect `GET /kdp/research/weekly` and private update records for
blocked/uncertain states; never classify a saved draft or button click as live.
