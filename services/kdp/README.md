# KDP service

The authenticated AIMS `/kdp` service exposes two subservices backed by the KDP template engine:

- `KDP_publishing` prepares titles, uploads manuscript/cover files, updates categories and publishes Kindle Direct Publishing listings.
- `KDP_audit` builds read-only reports from the D1 ebook catalogue and public Amazon product pages. An optional signed-in KDP audit collects setup metadata and price-band findings. Audit and royalty reports are stored privately.

Public audits automatically reconcile verified Kindle page-count differences to the D1 website catalogue. They do not change KDP listings; metadata and pricing changes on KDP are separate operations. Monthly Council scheduling and automatic approval of other changes are not configured here.

The MAST-triggered weekly research job searches for candidate Kindle competitors in the US and UK and recent topic sources. It requires a complete Monday public audit started between 12:00 and 15:00 Europe/London and runs Tuesday–Thursday in the same window. With `TAVILY_SEARCH_API` and durable R2 state configured, it selects a rotating batch (default 15), makes four Tavily basic searches per book, and checkpoints after each book. It processes at most one book per minute; unfinished work resumes in the next available window. `/kdp/research/weekly` returns the current private state; completed and carried-over research is archived under `research/weekly/` in the private KDP bucket. MAST triggers the Monday audit and the Tuesday–Thursday research runs.

Search results are leads only, not verified Kindle prices, comparable-title assessments, validated trends, or proof that the book covers a topic. The worker never writes KDP, D1, or the website. The update pipeline, source verification and LLM evaluation remain separate work. The preliminary pricing helper requires independently verified comparable records. UK candidate prices have a £6.43 baseline, and the live optimisation process applies a higher file-size-aware royalty floor. US candidates retain a $4.99 default. The weekly workflow has separate evidence and update stages.

The research job also attempts to capture up to five candidate product pages per market. It records page identity, title, description, page count, price and whether the price came from an explicit Kindle element. Comparability and promotion status remain unknown. If Amazon blocks a request, the job stops and preserves the search leads for a later retry without spending additional search credits.

When a fresh signed-in metadata snapshot uniquely matches the catalogue ASIN, an ASIN-verified live product page was captured in the Monday audit, and dated topic sources exist, research can draft evidence-grounded metadata improvements. The writer and separate reviewer use free-first OpenRouter routes and at most one economy-model fallback on error or malformed output. Every proposed description sentence needs an exact supporting book-content quote; keywords need both book and source evidence. Approved changes are durably queued for the existing authenticated KDP update worker, which is invoked again in the same permitted submission window. Technical failures are retried once, checkpointed with safe error codes and surfaced as a failed scheduled job rather than silently accepted.

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
| `KDP_OTP_CHALLENGE_TIMEOUT_MS` | Optional OTP timeout; defaults to 300 seconds (5 minutes) |
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

OTP messages and codes are never logged or persisted. The broker records only the latest non-secret delivery outcome (e.g. sender_not_allowed/no_active_challenge/consumed) on `/kdp/status` for troubleshooting. The broker is process-local with one active challenge, so run one AIMS replica and serialize KDP writes. Move the broker to shared, TTL-capable state with atomic one-use delivery before scaling to multiple replicas.

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
| GET | `/kdp/audit/pricing/ranges` | Read-only per-book UK Kindle and provisional UK/US paperback/hardback minimum–maximum bands, exact file sizes, page-count assumptions, reasons and eligibility states. No KDP writes. |
| GET | `/kdp/audit/pricing/royalty-floor` | Read-only complete D1/KDP royalty-floor plan and readiness counts |
| POST | `/kdp/audit/pricing/royalty-floor/run` | Durable UK £4.50 royalty-floor reconciliation; defaults to `dryRun: true`, requires explicit `{"dryRun":false}` to submit a change | 
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

## UK royalty-floor rollout

Unlike competitor-led research optimisation, the existing-book £4.50 royalty-floor correction is an independent policy rollout. D1 lists the 40 known Kindle titles; the fresh, signed-in KDP snapshot supplies each title ID, current UK price and delivery file size. The signed-in royalty plan must be verified as 70% on the actual KDP form, never guessed from the old price or KDP Select enrolment. The metadata parser reads KDP's selected `royalty_rate-radio`, with an authenticated rendered-page fallback when the static HTML omits its value.

`GET /kdp/audit/pricing/royalty-floor` is a non-mutating inventory. `POST /kdp/audit/pricing/royalty-floor/run` starts an asynchronous job, with dry-run enabled by default. MAST calls it with `{"dryRun":false}` three times per day Monday–Thursday at 16:35, 18:35 and 21:00 London, after the normal research window. The job only submits **one price correction per run** and enforces a global minimum one-hour gap. This is a price-only update to an existing title, not the separate print/new-title quota.

On every live attempt, the job matches a complete recent signed-in KDP Bookshelf snapshot to D1, then opens the precise authenticated title/pricing pages. A fresh pricing-page ASIN must independently match the snapshot and D1 before any price mutation; this avoids repeating the full paginated Bookshelf scan, whose timeout prevented the 19 November runs. LIVE status, confirmed 70% plan, current UK price, actual file size, 70% price band and delivery-adjusted floor remain mandatory. R2 `pricing/royalty-floor/ledger.json` records `submitting` **before** any KDP write. On a timeout or uncertain submission it does **not** replay a Publish; later runs check signed-in and public Amazon UK Kindle prices and require both to reach the floor before marking `verified`. Missing proof becomes `blocked` or `needs_attention` and is visible in R2 `pricing/royalty-floor/latest.json` and the MAST job result. Read-only browser failures are recorded with bounded retries and safe error codes before any KDP side effect. This route relies on its durable mutation ledger and lease for idempotency rather than a generic HTTP duplicate handler that lacks the asynchronous job ID. The signed-in snapshot must be at most eight days old, match the whole D1 catalogue and be refreshed by the normal Monday sync. Values already above the verified minimum are left untouched.

This rollout changes only the UK Kindle list price. It does not change other marketplace prices, paperbacks, hardbacks, cover files or descriptions. A recorded submission is not proof of a published Amazon price, and the £4.50 target only covers eligible UK 70% sales at normal list prices.

## Service limits

- The KDP website is not a stable public API. Browser selectors and Amazon sign-in policy can change; run a low-risk session check after deployment and before enabling scheduled jobs.
- Automated login supports one SMS OTP step through TextBee. Amazon CAPTCHA, unsupported MFA challenges, or an additional verification step fail closed and require operational intervention.
- A live KDP publishing transaction has not been exercised against the account in this integration. Use dry runs, verify staged assets and metadata, then perform an initial supervised publish before enabling automated publishing.
- `KDP_audit` is ready as an on-demand endpoint and report contract. Monthly Council scheduling and automated application of audit recommendations should be connected in a follow-up after reviewing report output and change policy.

## Weekly optimisation and rollout

MAST remains the sole clock: public D1/ASIN listing audit Monday 12:00 London,
setup metadata refresh Monday 12:15, rotating research batches Tuesday–Thursday
12:00. `KDP_RESEARCH_BATCH_SIZE` defaults to 15. Each research tick processes one
book, and pauses 60 seconds before continuing. The research never substitutes
KDP search results for the public audit.

Research combines captured Amazon recommendations with Tavily candidates and
recent dated sources. A free-first drafter and independently routed critic use the
`kdpResearchDraft` and `kdpResearchCritic` routes with distinct provider priorities. If inference fails
or returns malformed JSON, each stage permits at most one attempt with the
economy-model `kdpResearchPaidFallback` route; no premium council, no retry
loops. Competitor private keyword fields are not available.
Public wording informs suggestions, and every accepted keyword requires book and
source quotes. Proposed descriptions require supporting quotes for every sentence.
Two distinct source domains are required; a news mention is not search-volume data. Draft completion capacity is larger than the critic's short verdict to reduce valid JSON truncation. Private blocked records now retain bounded review and evidence-filter diagnostics without relaxing approval gates.

Prices target comparable medians with average prices retained in the evidence.
`KDP_RESEARCH_PRICE_FLOOR_USD_MINOR` defaults to 499 and
`KDP_RESEARCH_PRICE_FLOOR_GBP_MINOR` defaults to 643, both in pennies/cents;
the UK effective minimum is always the greater of its configured floor and
`ceil(£4.50 / 0.70)` plus verified KDP delivery cost, rounded UP to the next penny.
Existing lower GBP
environment overrides cannot defeat that rule. When signed-in delivery size or
70% plan cannot be verified, UK price changes are blocked rather than guessed.
At least three fresh unique Kindle comparisons are needed, with explicit local currency and no visible promotion.
This means **no promotion was visible**, not proof that the competitor has never
been discounted. Changes over 25% are withheld, and confirmed prices have a
28-day cooldown. Royalty-band validation is reused from the KDP engine.

Private R2 `research/updates/<week>/<ebookId>.json` records preserve proposals,
previous D1/KDP values, submission state and confirmation. Prepared records expire
after 48 hours to avoid submitting stale comparisons. The research tick also
reconciles a freshly prepared intent immediately within Tuesday–Thursday
12:00–15:00; all previously queued intents are retried by the independent
MAST daily update-verification schedule. A crash or timeout after entering `submitting` never automatically
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
Tavily/free-or-economy-model request, configured D1 write/cache-purge/rebuild credentials,
and one confirmed KDP-to-website update. Local mocks and CI do not establish those
production facts. Inspect `GET /kdp/research/weekly` and private update records for
blocked/uncertain states; never classify a saved draft or button click as live.


### Paperback and hardback rollout capacity (November 2026)

The AIMS operator target is **ten existing books per UTC week**, creating and first-submitting up to ten paperbacks **and** ten hardcovers (independent per-format counters). The authenticated MAST production job remains at 22:15 Europe/London, Monday–Thursday, with a maximum of three books per night, no Friday print submissions, and a 22:50 cutoff for starting additional formats. The ten-title weekly ceiling is configurable downwards via `KDP_PRINT_WEEKLY_LIMIT_PER_FORMAT` but not above ten. This is a local operational target, not a guarantee that Amazon will accept ten titles: where signed-in KDP signals a lower limit, the worker stops the remaining queue for that run, marks the remote operation uncertain for reconciliation, and reports the failure to MAST. Every run persists per-format create/submit reservations to its R2 report and D1. D1 quota counters are versioned as `kdp_print_quota_counters_v2`, with prior reservations imported from the original two-title table without discarding them. A successful submission is not retail availability; the existing signed-in/public verification must separately confirm live paperback/hardback listings before website badges are exposed.


### Pricing policy across Kindle, paperback and hardback

#### Per-book dynamic pricing ranges, with explanations

`GET /kdp/audit/pricing/ranges` returns one row per D1 book covering all three formats. It shows file size, observed Kindle list price, the verified or unverified 70% plan, the **UK eBook royalty-safe minimum and size-tiered test maximum**, and paperback/hardback **minimum and maximum in GBP and USD** estimated from D1 page count. Each amount comes with its basis and a human-readable explanation. The endpoint is read-only, performs no Amazon writes, and labels provisional print prices as needing the actual final print PDF.

- **Kindle UK:** the lower bound is the smallest penny price meeting `(£4.50 / 70%) + signed-in KDP delivery cost`. The upper bound uses a conservative commercial *testing tier*: one extra pound for files under 350 KB; two extra for 350–399 KB; three extra for 400–449 KB; four extra for 450–499 KB; and at most six extra for larger files, never over the official £12.99 70% ceiling. These tiers describe the experiment, not objective book quality. The weekly competitor research chooses a price inside this range; other metadata updates cannot undo the £4.50 royalty floor. Actual KDP royalty-plan verification remains mandatory.
- **Paperback/hardcover:** the lower commercial bound is calculated from print manufacturing cost plus the £4.50 UK / $6 US direct-sale royalty requirement, then 10% headroom and upwards .99 rounding. The maximum adds `1 + ceil(final pages / 100)` currency units for paperback or `2 + ceil(final pages / 100)` for hardcover, capped at the existing hard format retail ceiling. For example, 300 final black-ink 6×9 pages give **£15.99–£19.99 paperback** and **£21.99–£26.99 hardcover** UK. Every page count affects manufacture and can alter both bounds. The live print repricer always uses the final-PDF asset manifest, never a provisional D1 catalogue page count.
- The current policy is **bounds and evidence**, not automatic maximal pricing. For live print, only prices outside the bounds are corrected, with durable intent and signed-in reconciliation. For Kindle, the mandatory floor worker corrects prices below the minimum; verified market research can propose a different price inside its size-tiered band, subject to the existing 25% change and cooldown gates. Missing book identity, size, plan, print PDF or signed-in prices blocks unsafe automatic changes.


**Kindle** uses the verified 70% plan and title-specific delivery-size calculation to set the smallest penny price that clears the UK floor, alongside market-researched price updates. MAST runs royalty correction at 16:35, 18:35 and 21:00 Europe/London, Monday–Thursday. The UK floor is a minimum **£4.50 estimated royalty for an eligible direct Kindle purchase**, not a claim about all territories, KDP Select reads or promotions. Do not substitute the print royalty rate for Kindle.

**Paperback and hardcover** use separate KDP direct-Amazon royalty calculations at 60% of the marketplace-specific list price **minus local printing cost**, based on the actual final 6x9 black-ink/white-paper PDF page count in the private print-asset manifest. The operator floor is £4.50 in Amazon UK and $6 in Amazon US. To avoid awkward retail prices such as £13.92, the policy applies 10% headroom above the minimum viable price and rounds *up* to a .99 price. A hard retail ceiling of **£19.99/$29.99 paperback** and **£27.99/$39.99 hardcover** prevents raising a price to an unreasonable level merely to hit the royalty objective. If print costs or final pages make both floor and ceiling impossible, the worker blocks publication or repricing and flags the exact issue; it never silently undercuts the floor.

The current 185–393-page catalogue produces modelled **UK minimums** of about **£13.99–£17.99 paperback** and **£19.99–£23.99 hardcover** before Amazon confirms actual final page counts and manufacturing costs. More than £4.50 direct-Amazon royalty is anticipated, not a guaranteed net return in other channels. **Expanded Distribution paperbacks pay 40% before printing costs**, so the direct-Amazon floor does not guarantee £4.50 in that channel; only opt into expanded distribution under a separately confirmed pricing policy.

**Automatic print price updates** use GET /kdp/audit/pricing/print for read-only inventory and POST /kdp/audit/pricing/print/run with dryRun=false for a live reconciliation. MAST schedules 17:40 and 19:40 London Monday–Thursday, between existing Kindle royalty-floor slots, with no automatic Friday price writes. The repricer only selects print editions already independently verified live, requires exact KDP title/format/ISBN and matching private asset manifest, and reads both actual signed-in GBP and USD prices. It raises a price below the calculated page-count-specific minimum and lowers a price only when above that edition's dynamic page-count-specific maximum; existing prices within the two bounds are preserved. The fixed format retail cap remains an absolute upper guardrail.

A versioned R2 ledger at pricing/print/ledger.json records the exact target **before** publishing; pricing/print/latest.json contains each run's results, pending and unresolved counts. An uncertain Publish is not repeated. KDP price propagation is allowed five days before signed-in verification, and unresolved updates remain blocked and visible. One edition can be updated per session with a minimum one-hour inter-submission interval. These updates change *only pricing*: never the manuscript, cover, ISBN, keywords or other markets' manual prices. **Signed-in KDP price verification is not independent proof of Amazon retail price propagation**. KDP says print list prices may take 3–5 days to update in retail. Keep the separate existing listing/purchase verification in place.

Sources:
- https://kdp.amazon.com/en_US/help/topic/G201834330
- https://kdp.amazon.com/en_US/help/topic/G201834340
- https://kdp.amazon.com/en_US/help/topic/G77F3WPD3KQLJTFS
- https://kdp.amazon.com/en_US/help/topic/GHT976ZKSKUXBB6H
- https://kdp.amazon.com/en_US/help/topic/G200644210
- https://kdp.amazon.com/en_US/help/topic/GQ8UH9SN83UFNVKR
