# AIMS professional operations and alerting

**Status:** Paid Koyeb production service
**Last reviewed:** 21 June 2026

AIMS records bounded professional-excellence telemetry in durable state. `GET /ops/excellence` exposes job success/failure counts, retry recoveries, repeated failure streaks and provider latency/failure aggregates without returning prompts, credentials, raw provider payloads or bearer tokens.

## Runtime variables

```env
AIMS_FAILURE_ALERT_THRESHOLD=3
OPS_ALERT_WEBHOOK_URL=https://<hive-api>/v1/ops/events
OPS_ALERT_WEBHOOK_TOKEN={{secret.OPS_EVENT_INGEST_TOKEN}}
OPS_ALERT_TIMEOUT_MS=8000
```

The telemetry file is `professional-excellence.json` and follows the existing durable-state backend. Job transitions update idempotent counters. OpenRouter calls record elapsed time and failure rates. A repeated job failure emits one event when the configured threshold is reached.

## Alert delivery rules

- Alert delivery is deliberately non-blocking so it cannot conceal the original failure.
- Alert payloads must be redacted and bounded.
- CI failures and Koyeb deployment failures should include run/deployment URLs and release SHA, not secrets.
- Runtime workflow alerts should include service, lane, job ID, failure class and next operator action.
- Do not include prompts, API keys, tokens, R2 signed URLs, full stack traces or provider raw responses.

## Partial-run recovery

1. Inspect durable job state, quarantine state and `/ops/excellence`.
2. Identify the last completed step and its idempotency key.
3. Do not replay publishing, email or bulk actions until downstream state is checked.
4. Resume through the governed route using the same job identifier where supported.
5. Retain the resulting state objects and provider IDs with the release evidence.

## Deployment notifications

GitHub CI failures and Koyeb paid-production deployment failures are forwarded to HIVE where configured. Configure repository secrets `KOYEB_TOKEN`, `KOYEB_SERVICE`, `OPS_ALERT_WEBHOOK_URL` and `OPS_ALERT_WEBHOOK_TOKEN`. Alert delivery is deliberately non-blocking so it cannot mask the original failure.
