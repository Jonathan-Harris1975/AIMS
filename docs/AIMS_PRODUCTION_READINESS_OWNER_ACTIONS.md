# AIMS production readiness: owner actions

## Repository changes and evidence boundary

The worker watch resolves the newest Koyeb deployment through the read-only Koyeb API and requires it to be healthy with an exact 40-character source SHA. It then requires the live Comms Hub health response to identify that same revision. It keeps a detected incident open when the deployment or response is missing, stale, unhealthy, or reports another revision. A recovery event is recorded only after the response passes the inventory and freshness checks for the expected revision. Alert-delivery failures remain visible and retry on a later watch run with the same event ID.

The application exposes its deployed source revision as `health.revision` from Koyeb's platform-provided `KOYEB_GIT_SHA` value (available for GitHub deployments). Production startup requires this to be a lowercase 40-character Git commit SHA. The monitor independently compares it with the newest healthy Koyeb deployment metadata; a missing, malformed, or mismatched value keeps recovery blocked. No manually maintained `AIMS_BUILD_SHA` setting is required.

The historical HTTP 503 recorded on 19 October 2026 is no longer the latest runtime evidence: the 4 November 2026 Comms Hub worker watch passed against main SHA `7afc35045e9f4e1311259fe8c72ec27a6fbb798d`, with the exact deployed revision check, authenticated live worker-health probe, and incident-state artifact all succeeding. This confirms current health for that revision, but does not establish uninterrupted health or independently verify external alert delivery.

## External evidence

- A later controlled repair handoff received a fresh `dispatch-state: accepted` acknowledgement on 3 November 2026 (for example, [PR #330](https://github.com/Jonathan-Harris1975/AIMS/pull/330), comments at 13:22 and 13:28 UTC). This supersedes the earlier HTTP 403 as the latest endpoint outcome. The accepted callback proves successful endpoint acceptance for that request, but does not independently expose provider-side app configuration.
- The historical worker-watch run [39179452806](https://github.com/Jonathan-Harris1975/AIMS/actions/runs/39179452806) failed with HTTP 503 on 19 October. The current exact-SHA worker-health verification is [run 41822683963](https://github.com/Jonathan-Harris1975/AIMS/actions/runs/41822683963) and passed on 4 November.
- A read-only Cloudflare API check found the production data-plane Worker D1 and secret bindings matching the checked-in Wrangler configuration. Cloudflare account-level `enforce_twofactor` is `false`.
- The 4 November deployment watch verified Koyeb minimum-instance configuration before and after the watch and passed the deployed-SHA check. The independent worker watch then executed the authenticated health probe inside Koyeb. Repository evidence still cannot expose current environment-variable values or independently verify downstream alert acknowledgement.

## Owner configuration still required

1. **Koyeb service owner:** the app now reads `KOYEB_GIT_SHA`, which Koyeb supplies automatically for GitHub deployments; no hand-maintained build SHA is required. Confirm the service remains GitHub-backed and review the exact deployed SHA during the live recovery check. Keep the already verified durable-state settings as configured; missing durable state still fails production startup.
2. **Kilo/provider owner:** the earlier HTTP 403 is superseded by accepted repair handoffs on 3 November. Keep the current endpoint secret and repository/workflow/branch trust constraints. Provider-side app configuration and permissions remain not directly inspectable from this repository.
3. **GitHub repository owner:** verify the `Koyeb` environment has `KOYEB_TOKEN`, `KOYEB_SERVICE`, and an `OPS_ALERT_WEBHOOK_URL` with `OPS_EVENT_INGEST_TOKEN` (or the existing fallback `OPS_ALERT_WEBHOOK_TOKEN`). Confirm the running Koyeb service has `AIMS_API_KEY` or `AI_SUITE_API_KEY`. Review environment protection and secret access in GitHub settings. The repository cannot read or configure those values.
4. **Cloudflare/platform owner:** the live `aims-comms-hub-data-plane` Worker has `COMMS_HUB_DB` bound to `database-comms-hub` and has the `COMMS_HUB_D1_PROXY_TOKEN` secret binding; these match `workers/comms-hub-data-plane/wrangler.toml`. Account `enforce_twofactor` is currently `false`, so enable account-level 2FA enforcement and verify user MFA. Review whether the provider supports the ecosystem-wide GitHub OIDC trust model. Where supported, bind issuer, audience, repository identity, workflow, and `refs/heads/main` narrowly. The current repository OIDC workflow verifies GitHub’s signed claims only; it does not prove that an external provider trusts them. Do not broaden trust to make a check pass.
5. **Operations owner:** verify the independent alert endpoint accepts failure and recovery events and deduplicates by `event_id`. The watch retains delivery status, but it cannot prove downstream acknowledgement from repository evidence alone.

## Controlled live verification

After owner configuration, run this sequence against a non-production service and record the exact source SHA and workflow run URLs:

1. Latest production verification: [run 41822501681](https://github.com/Jonathan-Harris1975/AIMS/actions/runs/41822501681) records the deployment attestation for `7afc35045e9f4e1311259fe8c72ec27a6fbb798d`; [run 41822683963](https://github.com/Jonathan-Harris1975/AIMS/actions/runs/41822683963) then passed the exact-revision worker-health check.
2. Keep the scheduled worker watch active; it fails closed on stale health, wrong revision, missing inventory, or endpoint errors.
3. Simulate a worker 503 in the non-production environment. Confirm one open incident is persisted, one failure event is accepted, and repeated watch runs retain the same incident ID without a duplicate event.
4. Return the service to health while its revision is still `<expected-sha>`. Confirm the recovery event includes the matching revision and `checkedAt`, and only then is the incident marked closed.
5. Repeat with a different SHA, missing revision, stale health response, unavailable storage, and unavailable webhook. Each case must fail closed, keep/reopen the incident as applicable, and retain redacted evidence. Confirm the same-incident event IDs are deduplicated by the receiving system.
6. Verify recovery/incident artifacts are available from GitHub Actions and contain no credentials or full provider response bodies.

Do not treat a single healthy sample as proof of uninterrupted availability; retain scheduled exact-SHA health checks and incident evidence.
