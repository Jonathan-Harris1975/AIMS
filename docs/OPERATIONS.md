# AIMS production operations

**Status:** Paid Koyeb production service  
**Last reviewed:** 17 June 2026

AIMS runs as one non-root Koyeb Web Service with durable state and fail-closed production settings. Use `/livez`, `/readyz`, `/ops/health` and `/ops/excellence` to distinguish process health, dependency readiness and workflow/provider quality.

The professional-excellence state records job outcomes, retry recovery and provider latency/failure aggregates. Repeated workflow failures send a bounded event to HIVE. During recovery, preserve job IDs and provider artefacts, check idempotency before replaying destructive work and retain a dry-run evidence pack for each release.

Deployment notification and recovery details are in [`OPERATIONAL_ALERTING.md`](OPERATIONAL_ALERTING.md).
