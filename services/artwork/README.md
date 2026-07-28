# Artwork service

**Live route prefix:** `/artwork`

Generates editorial artwork through OpenRouter-compatible image models and stores/publishes outputs through the configured R2 artwork paths.

## HTTP contract

- `POST /artwork/create` — create artwork through the service-level creation flow.
- `POST /artwork/generate` — direct generation route used by content pipelines.

Blog and podcast callers provide format-specific prompts and target metadata. The service applies bounded model timeouts and returns the generated asset metadata required by the parent workflow.

## Behaviour

Key controls: `OPENROUTER_ART`, `OPENROUTER_ART_BACKUP`, `ARTWORK_MAX_TOKENS`, `ARTWORK_TIMEOUT_MS`, `BLOG_ARTWORK_TIMEOUT_MS`, `PODCAST_ARTWORK_TIMEOUT_MS`, R2 art/blog-image bucket settings.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
