# Cloudflare service

**Live route prefix:** `/cloudflare`

Performs authenticated Cloudflare cache operations and synchronises the shared website shell when required.

## HTTP contract

- `GET /cloudflare/health` — credential/config readiness without exposing secret values.
- `POST /cloudflare/purge` — purge configured cache targets.
- `POST /cloudflare/site-shell/sync` — synchronise site-shell assets/content for the configured deployment workflow.

## Behaviour

Production calls use AIMS bearer authentication and can additionally require `CLOUDFLARE_PURGE_SHARED_SECRET`. Configure zone/account/API credentials, `CLOUDFLARE_PURGE_TIMEOUT_MS` and site-shell settings in the deployment environment.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
