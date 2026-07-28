# Shared utility contracts

This directory contains reusable production utilities used across AIMS. The utilities are implementation infrastructure; live HTTP availability is defined by the owning service routes and `routes/index.js`.

## Utility groups

### AI execution
Helpers standardise OpenRouter requests, model selection, fallback behaviour, token/temperature settings, retry/backoff and failure reporting. Service code remains responsible for selecting the appropriate task model and validating the returned content.

### Storage
R2 helpers resolve configured bucket aliases and provide object read/write/list operations. Public URLs are built only from configured public-base values. Secret credentials remain deployment-only.

### State and jobs
Durable state/job helpers track long-running pipelines, batch cursors, schedule claims and status payloads. Ephemeral process memory is not a substitute where the workflow must survive restarts.

### Internal calls
Internal-service request helpers provide consistent AIMS-to-AIMS HTTP calls with bearer authentication, trigger metadata, timeouts and error handling.

### Validation
Shared request schemas and content validators provide reusable fail-closed checks. Domain rules belong to the service that owns the content type.

### Dedupe/idempotency
Hookdeck and schedule-claim helpers prevent duplicate execution/publication when triggers are retried.

### Operational health
Operational helpers expose readiness, excellence/failure snapshots and alert hooks without leaking secrets.

### HIVE
HIVE utilities resolve the central AIMS skills manifest/index in read-only mode and provide controlled skill lookup to service code.

## Configuration source of truth

Do not maintain a second environment-variable catalogue in this file. The current runtime contract is defined by:

1. `config/production.defaults.env`
2. `env.template`
3. service-local config modules and `config/thresholds.js`
4. the route/service code that consumes each variable

This avoids documentation drift and keeps the README focused on how the live utilities are intended to be used.

## Engineering rules

- Reuse shared clients/utilities instead of creating duplicate provider clients.
- Never log secret values.
- Use bounded network timeouts.
- Retry only transient failures.
- Validate data before persistence/publication.
- Use durable state for restart-sensitive workflows.
- Preserve idempotency for externally triggered jobs.
- Keep service-specific policy in the owning service rather than in generic helpers.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
