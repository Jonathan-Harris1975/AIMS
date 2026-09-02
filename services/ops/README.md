# Operations service

**Live route prefix:** `/ops`

Owns AIMS weekday morning task sequences, the Friday podcast window and operational readiness endpoints. MAST calls these windows; AIMS executes the individual internal service tasks sequentially.

## HTTP contract

- `GET /ops/windows` — list available operation windows.
- `POST /ops/run/:window` — run a named window.
- `GET /ops/jobs/:id` — inspect operation job state.
- `GET /ops/health` — service health.
- `GET /ops/preflight` — readiness checks for a target service/path.
- `GET /ops/warmup` — warmup-stage readiness.
- `GET /ops/excellence` — operational-excellence snapshot.

## Behaviour

Morning task spacing uses `AIMS_OPERATION_AM_DELAY_MS`. The Friday podcast readiness check flows immediately into the pipeline through `AIMS_OPERATION_FRIDAY_PM_DELAY_MS=0`; the legacy general PM delay remains available for any future multi-service PM window. Task execution uses `AIMS_OPERATION_TASK_TIMEOUT_MS`. `AIMS_OPS_PREFLIGHT_STRICT` controls whether missing readiness inputs become hard failures. Friday AM prepares both Blotato schedule slots and Saturday/Sunday Zernio content. Friday PM runs only the podcast pipeline.

Blotato and the daily Zernio lane run independently of the RSS rewrite task. Tasks remain sequential to control load, but a content failure in one lane no longer suppresses either social provider before its API call.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.

Accepted async jobs are not treated as finished. The operations service polls each returned `statusUrl` until the child job reaches a terminal state. This applies to the two daily Blotato renders and the Friday podcast pipeline, ensuring MAST pauses AIMS only after actual completion. The Monday Zernio daily lane owns the weekly mini-series exactly once; it is not duplicated as a separate operation task.

Successful and actively heartbeating operation windows remain one-shot for the London calendar day. Failed, `completed-with-failures` and stale interrupted receipts are automatically recoverable after a bounded cooldown. Recovery carries forward successful task results and runs only failed, skipped or unfinished tasks. Configure this with `AIMS_OPERATION_AUTO_RECOVERY_ENABLED`, `AIMS_OPERATION_MAX_ATTEMPTS`, `AIMS_OPERATION_RECOVERY_COOLDOWN_MS`, `AIMS_OPERATION_STALE_AFTER_MS` and `AIMS_OPERATION_HEARTBEAT_MS`. Provider-level slot claims and request IDs remain the final duplicate guard.
