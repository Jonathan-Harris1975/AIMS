# AIMS production readiness: owner actions

## Repository changes and evidence boundary

The worker watch resolves the newest Koyeb deployment through the read-only Koyeb API and requires it to be healthy with an exact 40-character source SHA. It then requires the live Comms Hub health response to identify that same revision. It keeps a detected incident open when the deployment or response is missing, stale, unhealthy, or reports another revision. A recovery event is recorded only after the response passes the inventory and freshness checks for the expected revision. Alert-delivery failures remain visible and retry on a later watch run with the same event ID.

The application must expose its deployed source revision as `health.revision`. Production startup therefore requires `AIMS_BUILD_SHA` to be the exact lowercase 40-character Git commit SHA in the running service. The monitor supplies the expected revision from Koyeb's latest healthy deployment metadata. A mismatched or absent value intentionally prevents incident closure.

The historical HTTP 503 recorded on 19 October 2026 remains unresolved by this repository change. No live probe or production recovery was performed.

## Owner configuration still required

1. **Koyeb service owner:** configure `AIMS_BUILD_SHA` from the exact source commit used for each service deployment. Confirm the service build/deploy process updates it on every release. Keep `ALLOW_EPHEMERAL_STATE=false` and the durable-state variables available: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and one supported metasystem bucket variable. Missing durable state now fails production startup. Do not set placeholder values.
2. **Kilo/provider owner:** restore the intended least-privilege repair handoff using the existing `KILO_REPAIR_TRIGGER_URL` repository secret and GitHub App credentials `AUTONOMY_REPAIR_APP_ID` / `AUTONOMY_REPAIR_APP_PRIVATE_KEY`. Verify the endpoint's authorization for this repository and one controlled non-production request. The audit recorded HTTP 403; repository code cannot grant the external permission. Keep the existing repository/workflow/branch trust constraints.
3. **GitHub repository owner:** verify the `Koyeb` environment has `KOYEB_TOKEN`, `KOYEB_SERVICE`, and an `OPS_ALERT_WEBHOOK_URL` with `OPS_EVENT_INGEST_TOKEN` (or the existing fallback `OPS_ALERT_WEBHOOK_TOKEN`). Confirm the running Koyeb service has `AIMS_API_KEY` or `AI_SUITE_API_KEY`. Review environment protection and secret access in GitHub settings. The repository cannot read or configure those values.
4. **Cloudflare/platform owner:** verify the AIMS Worker’s D1 binding and secret binding against the checked-in Wrangler configuration; enable account-level 2FA enforcement and verify user MFA. Review whether the provider supports the ecosystem-wide GitHub OIDC trust model. Where supported, bind issuer, audience, repository identity, workflow, and `refs/heads/main` narrowly. The current repository OIDC workflow verifies GitHub’s signed claims only; it does not prove that an external provider trusts them. Do not broaden trust to make a check pass.
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
