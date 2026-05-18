# Outreach service

## Status

**Implemented.** This page documents behaviour backed by files in `services/outreach/`.

## Purpose

Runs keyword-based lead discovery by querying SERP results, filtering domains, enriching contacts, validating email addresses, scoring leads and appending accepted rows to Google Sheets.

## Routes

- `GET /outreach/health`
- `POST /outreach/keyword`
- `POST /outreach/batch/next`
- `POST /outreach/batch/reset`

## Main files

- `routes/index.js`
- `services/outreachService.js`
- `services/serp-OutreachService.js`
- `services/outreachCore.js`
- `services/zeroBounceBatch.js`
- `services/batchService.js`
- `services/sheetService.js`
- `utils/filters.js`
- `utils/r2ProgressStore.js`

## Workflow

- `/keyword` validates a keyword and runs one scan.
- SERP results are reduced to unique domains.
- Domains matching hard-block lists/suffixes/fragments are removed.
- Providers enrich email/contact and authority signals.
- ZeroBounce validates email batches if configured.
- Leads are scored against env thresholds.
- Accepted rows are appended to Google Sheets.
- Batch mode advances a cursor through `OUTREACH_KEYWORDS` when provided, otherwise through `services/outreach/keywords.txt`.

## Environment variables

- `OUTREACH_KEYWORDS`, optional `OUTREACH_KEYWORDS_FILE`, `OUTREACH_BATCH_SIZE`, `OUTREACH_MIN_LEAD_SCORE`, `OUTREACH_MIN_EMAIL_SCORE`, `OUTREACH_PROGRESS_KEY`
- `SERP_RATE_DELAY_MS`, `HUNTER_DELAY_MS`, `ZEROBOUNCE_*`
- `API_SERP_KEY`, `API_OPENPAGERANK_KEY`, `API_URLSCAN_KEY`, `API_PROSPEO_KEY`, `API_HUNTER_KEY`, `API_APOLLO_KEY`, `API_ZERO_KEY`
- `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`
- R2 metasystem env for production batch progress

## External integrations

- SERP API
- OpenPageRank
- urlscan.io
- Prospeo
- Hunter
- Apollo
- ZeroBounce
- Google Sheets
- Cloudflare R2 metasystem state

## Storage

Batch progress defaults to R2 alias `metasystem` key `outreach/progress.json`, or `OUTREACH_PROGRESS_KEY` if set. Local fallback is blocked in production unless ephemeral state is explicitly allowed.

## Tests

No dedicated outreach route test was found.

## Common troubleshooting

- `API_SERP_KEY missing`: configure SERP key.
- Threshold errors: set numeric `OUTREACH_MIN_LEAD_SCORE` and `OUTREACH_MIN_EMAIL_SCORE`.
- No rows appended: check email validation, score thresholds and Google Sheets credentials.
- Batch does nothing: configure `OUTREACH_BATCH_SIZE` and either `OUTREACH_KEYWORDS` or `services/outreach/keywords.txt`. The batch response reports `keywordSource`, `keywordCount`, and file path diagnostics.

## Connections to other services

Uses shared R2 state, shared wait helper and Google APIs. It is independent from podcast/blog flows.
