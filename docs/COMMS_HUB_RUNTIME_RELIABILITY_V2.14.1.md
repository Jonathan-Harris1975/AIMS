# Comms Hub Runtime Reliability v2.14.1

This release consolidates the complete v2.14.0 Outreach automation branch with the later multi-mailbox, automatic D1 migration and environment-sanity work, then closes the runtime gaps found during the 2026-08-17 production audit.

## Reliability changes

- Social polling now passes the complete Comms Hub runtime context into social persistence. Polled Facebook/Instagram DMs, Facebook/Instagram comments and YouTube comments can therefore reach attachment handling, human-contact handling and policy-gated AI automation just like webhook-delivered events.
- A Zernio webhook reconciliation worker runs at Comms Hub startup and periodically thereafter. It recreates or updates the enabled Meta and Video webhooks against `COMMS_HUB_PUBLIC_BASE_URL` and reapplies the configured webhook secrets.
- Comms Hub startup has a bounded supervisor. Recoverable startup or schema-recovery failures are retried with exponential backoff instead of leaving the HTTP process alive while Comms Hub stays permanently failed.
- D1 schema recovery remains automatic and now tracks migrations through `0010_runtime_reliability`.
- A narrow `social_engagement` autonomous policy allows low-risk social acknowledgements to proceed without an AI Search evidence hit. The existing general social policy remains evidence-required and higher confidence.
- The obsolete Comms Hub wake relay and `COMMS_HUB_WAKE_*` configuration have been removed. Incoming HTTP requests already wake the AIMS service. Continuous IMAP/social/delayed-action polling requires the AIMS Koyeb service to keep at least one instance running.
- AIMS health/readiness responses now use the package version instead of the old `2.9.7` fallback.
- The full v2.14.0 guest-article Outreach implementation and migration `0009_outreach_automation` are restored. The internal AIMS Outreach scheduler remains disabled while the authenticated Make.com trigger owns the schedule, preventing duplicate Outreach runs.

## Required deployment setting

For automatic email polling, social polling, delayed replies, follow-ups and provider monitoring, configure the AIMS Koyeb service with a minimum of **1 running instance**. Those workers are in-process timers and cannot run while Koyeb has scaled the service to zero.

## Operational readiness

Use `GET /livez` only for process liveness. Use `GET /readyz` for AIMS operational readiness because it includes Comms Hub runtime state. HIVE production defaults in the companion update now use the AIMS `/readyz` endpoint for operational monitoring.

## External integrations that remain intentionally external

Jotform submissions still require the three production Jotform forms to be configured to deliver their webhook to:

`https://app.jonathan-harris.online/comms-hub/intake/jotform`

The current Jotform client validates and processes submissions after delivery. This release does not invent or assume an unverified Jotform webhook-management API contract.

## Zernio endpoints

- Meta: `https://app.jonathan-harris.online/comms-hub/intake/zernio/meta`
- Video: `https://app.jonathan-harris.online/comms-hub/intake/zernio/video`

When the respective family is enabled and correctly credentialled, AIMS now reconciles these webhooks automatically.
