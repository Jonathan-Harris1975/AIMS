# Comms Hub Runtime Reliability v2.14.1

This document describes the current v2.14.1 Comms Hub runtime-reliability contract after the production revalidation work.

## Reliability controls

- Social polling passes the complete Comms Hub runtime context into social persistence, allowing eligible polled DMs/comments to use the same governed automation path as webhook-delivered events.
- A Zernio webhook reconciliation worker runs at startup and periodically thereafter for enabled credential families.
- Comms Hub startup has a bounded supervisor with exponential backoff for recoverable startup/schema failures.
- D1 schema recovery uses the required migration manifest, currently through `0022_worker_heartbeat`.
- The obsolete Comms Hub wake relay and `COMMS_HUB_WAKE_*` configuration remain retired. HTTP traffic may wake a sleeping web service, but unattended IMAP/social/delayed/follow-up/provider workers require a continuously running AIMS instance.
- Critical continuous workers write durable per-instance heartbeat state to D1. This state records only worker category/key, enabled state, cadence, timestamps and a bounded error code.
- AIMS health/readiness responses use the package version rather than a historical hard-coded fallback.

## Mandatory Koyeb minimum-instance release gate

Production must keep the AIMS Koyeb service at **minimum 1 instance**. Koyeb supports a minimum of zero, which enables scale-to-zero; that configuration is incompatible with continuous in-process communication workers.

The repository now enforces the requirement in `.github/workflows/koyeb-deployment-watch.yml`:

1. the production workflow fails if `KOYEB_TOKEN` or `KOYEB_SERVICE` is absent;
2. the pinned Koyeb CLI is downloaded and checksum-verified;
3. `npm run koyeb:min-instances:check` queries the actual service selected by `KOYEB_SERVICE`;
4. the verifier validates the returned service identity and every `definition.scalings[].min` value;
5. API/auth/CLI failures, missing or malformed scaling data and any minimum below 1 exit non-zero;
6. the gate runs before the deployment watch and again after the expected deployment becomes healthy;
7. only then is the exact-SHA production deployment attestation retained and the ecosystem smoke dispatched.

The verifier never prints the Koyeb token. It is also runnable manually with the same two environment variables.

## Durable background-worker heartbeat

Migration `0022_worker_heartbeat` adds `comms_hub_worker_heartbeats`. Heartbeats are keyed by worker category, worker key and runtime instance ID so restarts and concurrent instances remain externally observable.

Tracked critical categories are:

- `inbound_email` per configured mailbox/account;
- `social_poll`;
- `delayed_actions`;
- `follow_up`;
- `provider_monitor`.

Each worker records registration, attempts, successful loop completions and failures. Freshness thresholds are derived from the configured polling cadence: the service reports `healthy`, then `degraded`, then `stale` as the latest successful cycle ages. Missing success for an enabled worker is `stale`; disabled workers are explicitly `disabled`. An already-running/stopping skip does not refresh success, so a hung run cannot keep itself falsely healthy.

Email mailbox work remains business-hours aware. The timer still enters the worker outside business hours so the heartbeat can prove that the loop is alive, while `runOnce` returns `outside_business_hours` before mailbox access.

Use authenticated `GET /comms-hub/workers/health` for this signal. The endpoint returns HTTP 503 when the overall worker state is stale and exposes no message content, addresses or secrets. `GET /comms-hub/metrics` includes the same current heartbeat summary.

## Liveness versus readiness versus background health

- `GET /health` — shallow AIMS HTTP response.
- `GET /livez` — process/lifecycle liveness.
- `GET /readyz` — application readiness, including Comms Hub configuration/runtime startup state.
- `GET /comms-hub/workers/health` — authenticated durable freshness of continuous background communication workers.

Background freshness is intentionally **not** folded into `/livez`; an HTTP process can be alive while a worker is stale. Monitoring should alert on the worker-health endpoint independently.

## Public integration base URL

Do not hard-code a historical Koyeb hostname in operational instructions. Jotform and Zernio webhook destinations are derived from the configured production base URL (`COMMS_HUB_PUBLIC_BASE_URL`):

- Jotform: `<COMMS_HUB_PUBLIC_BASE_URL>/comms-hub/intake/jotform`
- Zernio Meta: `<COMMS_HUB_PUBLIC_BASE_URL>/comms-hub/intake/zernio/meta`
- Zernio Video: `<COMMS_HUB_PUBLIC_BASE_URL>/comms-hub/intake/zernio/video`

The repository validates/processes incoming payloads and reconciles supported Zernio webhooks when their credential families are enabled. Jotform provider-side webhook management remains external and must be configured against the current production base URL.
