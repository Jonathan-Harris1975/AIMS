# AIMS production readiness: owner actions

## Repository changes and evidence boundary

The worker watch resolves the newest Koyeb deployment through the read-only Koyeb API and requires it to be healthy with an exact 40-character source SHA. It then requires the live Comms Hub health response to identify that same revision. It keeps a detected incident open when the deployment or response is missing, stale, unhealthy, or reports another revision. A recovery event is recorded only after the response passes the inventory and freshness checks for the expected revision. Alert-delivery failures remain visible and retry on a later watch run with the same event ID.

The application exposes its deployed source revision as `health.revision` from Koyeb's platform-provided `KOYEB_GIT_SHA` value (available for GitHub deployments). Production startup requires this to be a lowercase 40-character Git commit SHA. The monitor independently compares it with the newest healthy Koyeb deployment metadata; a missing, malformed, or mismatched value keeps recovery blocked. No manually maintained `AIMS_BUILD_SHA` setting is required.

The historical HTTP 503 recorded on 19 October 2026 remains unresolved by this repository change. No live probe or production recovery was performed.

## Read-only external state checked on 19 October 2026

- GitHub run [39185361555](https://github.com/Jonathan-Harris1975/AIMS/actions/runs/39185361555) logged `KILO_REPAIR_TRIGGER_URL` as a masked, nonempty Actions value. The upstream workflow conclusion was `skipped`; the log says no repair action was required, so that run did not call the endpoint. It does not supersede the audit's HTTP 403.
- The latest relevant worker-watch run, [39179452806](https://github.com/Jonathan-Harris1975/AIMS/actions/runs/39179452806), failed at 00:08:52Z and reported HTTP 503 from the AIMS worker health endpoint. This is runtime evidence of an unresolved failure, not a current deployment-SHA verification.
- A read-only Cloudflare API check found the production data-plane Worker D1 and secret bindings matching the checked-in Wrangler configuration. Cloudflare account-level `enforce_twofactor` is `false`.
- No direct Koyeb API or CLI connection was available in this check. Koyeb deployment metadata and the service's current environment variables, and durable-state settings remain unverified. No live probe, deployment, or production setting was changed.

## Owner configuration still required

1. **Koyeb service owner:** the app now reads `KOYEB_GIT_SHA`, which Koyeb supplies automatically for GitHub deployments; no hand-maintained build SHA is required. Confirm the service remains GitHub-backed and review the exact deployed SHA during the live recovery check. Keep the already verified durable-state settings as configured; missing durable state still fails production startup.
2. **Kilo/provider owner:** `KILO_REPAIR_TRIGGER_URL` was nonempty in the GitHub Actions environment on 19 October 2026 (the runner log masked it). That run was skipped before dispatch, so it does not verify endpoint authorization. The audit's HTTP 403 remains the latest dispatch result; keep the current secret unless you confirm it is wrong, and have the provider owner verify this repository's least-privilege authorization and one controlled non-production request. The GitHub App credentials are not independently verified by this skipped run. Keep the existing repository/workflow/branch trust constraints.
3. **GitHub repository owner:** verify the `Koyeb` environment has `KOYEB_TOKEN`, `KOYEB_SERVICE`, and an `OPS_ALERT_WEBHOOK_URL` with `OPS_EVENT_INGEST_TOKEN` (or the existing fallback `OPS_ALERT_WEBHOOK_TOKEN`). Confirm the running Koyeb service has `AIMS_API_KEY` or `AI_SUITE_API_KEY`. Review environment protection and secret access in GitHub settings. The repository cannot read or configure those values.
4. **Cloudflare/platform owner:** the live `aims-comms-hub-data-plane` Worker has `COMMS_HUB_DB` bound to `database-comms-hub` and has the `COMMS_HUB_D1_PROXY_TOKEN` secret binding; these match `workers/comms-hub-data-plane/wrangler.toml`. Account `enforce_twofactor` is currently `false`, so enable account-level 2FA enforcement and verify user MFA. Review whether the provider supports the ecosystem-wide GitHub OIDC trust model. Where supported, bind issuer, audience, repository identity, workflow, and `refs/heads/main` narrowly. The current repository OIDC workflow verifies GitHub’s signed claims only; it does not prove that an external provider trusts them. Do not broaden trust to make a check pass.
5. **Operations owner:** verify the independent alert endpoint accepts failure and recovery events and deduplicates by `event_id`. The watch retains delivery status, but it cannot prove downstream acknowledgement from repository evidence alone.

## Controlled live verification

After owner configuration, run this sequence against a non-production service and record the exact source SHA and workflow run URLs:

1. Deploy commit `<expected-sha>` and confirm Koyeb reports that exact revision healthy.
2. Confirm `/comms-hub/workers/health` returns HTTP 200, `service: "comms-hub"`, a fresh `checkedAt`, the expected worker inventory, and `health.revision: "<expected-sha>"`.
3. Simulate a worker 503 in the non-production environment. Confirm one open incident is persisted, one failure event is accepted, and repeated watch runs retain the same incident ID without a duplicate event.
4. Return the service to health while its revision is still `<expected-sha>`. Confirm the recovery event includes the matching revision and `checkedAt`, and only then is the incident marked closed.
5. Repeat with a different SHA, missing revision, stale health response, unavailable storage, and unavailable webhook. Each case must fail closed, keep/reopen the incident as applicable, and retain redacted evidence. Confirm the same-incident event IDs are deduplicated by the receiving system.
6. Verify recovery/incident artifacts are available from GitHub Actions and contain no credentials or full provider response bodies.

Do not mark the historical production incident resolved until the service owner supplies current, authoritative health and deployment evidence for the matching revision.
