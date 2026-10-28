# OpenRouter daily spend

OpenRouter is the sole configured LLM provider for this reporting scope. Analytics supplies recorded usage charges; application logs supply task attribution and quality outcomes. Token-price estimates must not replace missing billing evidence.

## Activation

1. Create a separate OpenRouter management API key and install it as the AIMS server secret `OPENROUTER_MASTER_KEY` (legacy alias: `OPENROUTER_MANAGEMENT_API_KEY`) in Koyeb. Never put its value in source control, report exports, browser URLs or chat. The inference key is deliberately not accepted. The key is used only against the fixed OpenRouter Analytics API host; management credentials must be treated as privileged secrets.
2. Enable `OPENROUTER_DAILY_SPEND_ENABLED=true` in the deployed environment (production defaults enable it; explicit deployment overrides win). Existing private R2 `metaSystem` storage credentials must work.
3. Redeploy and use the existing AIMS bearer authentication to POST `/ops/spend/openrouter/refresh`, then GET `/ops/spend/openrouter/daily`. Both return HTTP 503 rather than a zero when credentials or evidence are unavailable. Verify the returned period and collection time before calling the integration live.

The worker checks every 30 minutes while AIMS is running. After 07:00 Europe/London it refreshes the previous two complete calendar days, once per day, to capture recent provider adjustments. DST days use their actual 23/25-hour ranges. A sleeping/offline service cannot collect; the 08:00 report must mark stale evidence unavailable or explicitly dated. Reports remain provisional; two-day refresh is not a guarantee of final billing settlement. Historical dates can be queried again with the CLI.

## Access and interpretation

Private objects in the existing `metaSystem` bucket:

- `reports/openrouter-daily/YYYY-MM-DD.json`
- `reports/openrouter-daily/latest.json`

The authenticated GET endpoint accepts `?date=YYYY-MM-DD`. Reports and routes use `no-store`; no public reporting bucket is created. The latest pointer advances only when both requested daily reports reconcile. Reads do not automatically fetch provider data. Concurrent manual refreshes can duplicate analytics reads but never inference requests.

The collector discovers supported metrics/dimensions, then queries the account total and a model/app (or API-key) breakdown. Truncated, malformed or unreconciled responses are rejected. Account scope includes all traffic visible to the management key; do not label an app/model as AIMS, HIVE or RAMS without a verified mapping. Unattributed spend stays unattributed. Request counts are not completed tasks. Prompt/output text is not collected.

`recordedSpendUsd` is provider-recorded USD usage, excluding inferred VAT, top-ups and card FX. Scheduled snapshots leave `gbp` null: the reporting step must obtain a dated, sourced USD-to-GBP rate and label the conversion an estimate. Actual GBP settlement requires payment evidence. Quality, publication success, task costs, retries and shadow-evaluation overhead must be joined from operational evidence, never inferred from model names or request counts.

For a read-only historical query with an explicit FX reference:

```sh
node scripts/openrouterDailySpend.js --date 2026-10-27 --usd-gbp-rate 0.75 --fx-date 2026-10-28 --fx-source 'Example only: replace with verified rate source'
```

The example rate is illustrative, not current market data. CLI output is private account data; handle exports accordingly. Without FX options it returns USD and no GBP estimate. Missing credentials exit 2; provider/coverage failures exit 1. No automatic provider retry loop is added and no LLM call is made by collection.

Monitor daily snapshot age, missing/truncated/reconciliation errors and coverage alongside spend per successful task, QA pass rates, repair counts and publication outcomes. Compare matching workloads and separate weekly podcasts and experimental shadow costs. A lower account total alone does not prove efficiency or maintained quality.

API references: https://openrouter.ai/docs/api/api-reference/analytics/get-available-analytics-metrics-and-dimensions and https://openrouter.ai/docs/api/api-reference/analytics/query-analytics-data

## Activation release verification

The explicit “Activate OpenRouter Analytics” release binds the existing Koyeb secret `OPENROUTER_MASTER_KEY` to the same runtime variable using an additive service update, and enables collection. Creating an organisation secret alone does not expose it to the service. The inference credential remains separate. This one-time binding runs only for the activation merge, before exact-SHA deployment verification; later releases do not rewrite it.

After a verified production deployment, `scripts/verifyOpenRouterAnalytics.js` refreshes private snapshots and prints only daily aggregate USD charges, request counts, available metric names and breakdown row counts. No API keys, application identifiers or prompt content are logged. This operational diagnostic is non-blocking for application release health; its own failure means Analytics is not verified, regardless of the deployment attestation. A 403 may indicate the new key lacks OpenRouter management privileges. Report success only after observing an `openrouter.analytics.verified` result.
