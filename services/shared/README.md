# Shared runtime services

`services/shared` contains cross-cutting production components used by AIMS service modules. It is not an independent HTTP service.

## Shared concerns

### Authentication
`middleware/suiteAuth.js` supplies the AIMS bearer-auth middleware applied by the production route registry. Service-specific shared secrets may add narrower protection where required.

### AI/model access
Shared AI helpers provide OpenRouter request handling, model selection, fallbacks, timeout/retry behaviour, usage logging and structured-output support. Task-specific services supply the model class and prompt contract.

### R2 and durable state
Shared storage/state helpers centralise Cloudflare R2 clients, bucket alias resolution, JSON/object persistence and durable job/progress state. Services should not create competing storage abstractions for the same concern.

### Operational controls
Shared utilities provide operational-excellence snapshots, alerts/failure tracking, async job handling, trigger metadata and internal-service request conventions.

### Hookdeck dedupe
Dedupe utilities provide idempotency protection for triggerable workflows where repeated webhook/scheduler deliveries could otherwise duplicate work.

### Request contracts
`utils/requestSchemas.js` contains shared request validation schemas. Domain-specific schemas remain with the owning service where necessary.

### Content quality
The shared content-quality system enforces reusable policy such as British English, Jonathan Harris voice, source integrity, anti-hype language and format-independent publication standards. Specialist services add their own channel gates.

### HIVE skills
Shared HIVE utilities read the configured AIMS skill index/manifest from the central read-only skill store. AIMS consumes these capabilities without granting content services write authority over HIVE policy.

## Production route registry

`routes/index.js` is the authoritative list of mounted service groups. Shared code must not assume a module is publicly callable merely because it exports an Express router.

## Configuration

The deployment environment provides:

- AIMS auth/internal URL settings
- OpenRouter model and retry settings
- R2 endpoint, bucket and public-base settings
- Hookdeck/dedupe settings
- operational timeout/state settings
- HIVE skill manifest settings

See `config/production.defaults.env` and `env.template` for the complete current contract.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
