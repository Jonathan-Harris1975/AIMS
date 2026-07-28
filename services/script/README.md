# Podcast script service

**Live route prefix:** `/script`

Creates the written episode components used by the podcast pipeline: intro, main sections, synthesis/composition, outro, final editorial pass, transcript and metadata.

## HTTP contract

- `GET /script/health`
- `POST /script/intro`
- `POST /script/main`
- `POST /script/outro`
- `POST /script/compose`
- `POST /script/orchestrate`

The production router is `services/script/routes/index.js`.

## Behaviour

All major generation stages use the shared tone setter plus podcast-specific prompt contracts. The service applies source grounding, sentence/length controls, metadata/keyword generation and final editorial review before downstream TTS. Outputs are written to the configured raw-text, transcript, metadata and metasystem storage paths.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
