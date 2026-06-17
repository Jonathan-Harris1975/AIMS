# AIMS professional operations and alerting

**Status:** Paid Koyeb production service  
**Last reviewed:** 17 June 2026

AIMS records bounded professional-excellence telemetry in durable state. `GET /ops/excellence` exposes job success/failure counts, retry recoveries, repeated failure streaks and provider latency/failure aggregates without returning prompts or credentials.

## Runtime variables

```env
AIMS_FAILURE_ALERT_THRESHOLD=3
OPS_ALERT_WEBHOOK_URL=https://<hive-api>/v1/ops/events
OPS_ALERT_WEBHOOK_TOKEN={{ secret.OPS_EVENT_INGEST_TOKEN }}
OPS_ALERT_TIMEOUT_MS=8000
```

The telemetry file is `professional-excellence.json` and follows the existing durable-state backend. Job transitions update idempotent counters. OpenRouter calls record elapsed time and failure rates. A repeated job failure emits one event when the configured threshold is reached.

## Partial-run recovery

1. Inspect durable job state, quarantine state and `/ops/excellence`.
2. Identify the last completed step and its idempotency key.
3. Do not replay publishing, email or bulk actions until downstream state is checked.
4. Resume through the governed route using the same job identifier where supported.
5. Retain the resulting state objects and provider IDs with the release evidence.

## Deployment notifications

GitHub CI failures and Koyeb paid-production deployment failures are forwarded to HIVE. Configure repository secrets `KOYEB_TOKEN`, `KOYEB_SERVICE`, `OPS_ALERT_WEBHOOK_URL` and `OPS_ALERT_WEBHOOK_TOKEN`. Alert delivery is deliberately non-blocking so it cannot conceal the original failure.
