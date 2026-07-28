# Operations service

**Live route prefix:** `/ops`

Owns AIMS weekday AM/PM task sequences and operational readiness endpoints. MAST calls these windows; AIMS executes the individual internal service tasks sequentially.

## HTTP contract

- `GET /ops/windows` — list available operation windows.
- `POST /ops/run/:window` — run a named window.
- `GET /ops/jobs/:id` — inspect operation job state.
- `GET /ops/health` — service health.
- `GET /ops/preflight` — readiness checks for a target service/path.
- `GET /ops/warmup` — warmup-stage readiness.
- `GET /ops/excellence` — operational-excellence snapshot.

## Behaviour

AM and PM task spacing use `AIMS_OPERATION_AM_DELAY_MS` and `AIMS_OPERATION_PM_DELAY_MS`; task execution uses `AIMS_OPERATION_TASK_TIMEOUT_MS`. `AIMS_OPS_PREFLIGHT_STRICT` controls whether missing readiness inputs become hard failures. Friday PM runs Blotato `ai-playbook`, then podcast, then Saturday and Sunday Zernio scheduling.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
