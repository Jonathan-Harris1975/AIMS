# AIMS Comms Hub Service 15 Build Report

## Verdict

The rejected standalone Comms Hub package has **not** been reused as an application. This build preserves the uploaded AIMS repository and adds Comms Hub as service 15 through the existing route registry, authentication middleware, lifecycle, readiness, logger, shared HTTP client and shared R2 client.

The implemented scope is the first real vertical slice only: the three registered Jotform intakes. The one.com email adapter and Zernio social adapter remain explicit later slices rather than fabricated handlers.

## Implemented

- Exact public ingress: `POST /comms-hub/intake/jotform`.
- Registered forms only:
  - Contact me: `260281179574362`.
  - Case study: `262063136008044`.
  - Podcast enquiry: `262097861889073`.
- Jotform API re-verification before persistence.
- Strict form/submission identity matching.
- Deterministic contact, conversation, message and event identifiers.
- D1 migrations with immutable checksums and a required migration ledger.
- Atomic, idempotent D1 persistence for contacts, conversations, messages, attachment references and intake events.
- D1-backed distributed leases for the R2 receipt queue.
- Redacted integrity receipts only in the supplied public R2 bucket.
- Runtime startup, readiness, graceful shutdown and archive worker integration inside AIMS.
- Protected diagnostics, conversation lookup, archive status and manual drain routes.
- Service-specific 1 MB body limit for JSON, URL-encoded and multipart Jotform webhooks.
- Reserved one.com environment mappings without loading email passwords into the Jotform runtime.

## Validation performed

- **21 dependency-free tests passed; 0 failed.**
- AIMS `scripts/buildCheck.js` passed.
- 32 changed/new JavaScript files passed `node --check`.
- 17 Comms Hub JavaScript files passed relative-import resolution checks.
- Placeholder marker scan passed: no TODO, FIXME, HACK, placeholder, stub or not-implemented markers in the new service/tests.
- Embedded-secret assignment scan passed.
- The migration SQL was executed against Node SQLite in tests, including foreign keys, uniqueness and distributed lease behaviour.

## Validation not performed

The uploaded repository's `node_modules` directory contains 218 top-level directories but **zero files**. Core packages including Express, Supertest, dotenv, Pino and the AWS S3 client are therefore absent. An offline `npm ci` attempt also failed because the package cache is incomplete. Consequently, the complete AIMS dependency-driven suite and `test/comms-hub-routes.test.js` could not be executed in this sandbox.

This is not disguised as a pass. Run `npm ci` in the normal build environment, followed by `npm test` and `npm run build`, before deployment.

## Operational constraints

- The first slice uses Cloudflare's authenticated D1 REST query API from Koyeb. Keep it limited to the three form workflows. Before attaching one.com email or Zernio social event volume, move D1 access behind a constrained Cloudflare Worker API or another purpose-built data-plane adapter.
- The supplied `r2.dev` endpoint exposes objects publicly and is intended as a development endpoint. This build therefore writes redacted integrity receipts only. It does not write names, email addresses, telephone numbers, answers, message bodies, attachment URLs or files to R2.
- Jotform API verification consumes one API request per accepted webhook attempt. Account API limits must be monitored as traffic grows.

## Deployment order

1. Deploy the code with `COMMS_HUB_ENABLED=false`.
2. Configure `D1_UUID`, `D1_API_KEY`, `JOTFORM_API_KEY`, existing R2 credentials, `R2_BUCKET_COMMS_HUB=comms-hub` and the supplied Comms Hub public URL.
3. Run `npm ci`.
4. Run `npm run comms:migrate:status`.
5. Run `npm run comms:migrate`.
6. Run `npm test` and `npm run build`.
7. Set `COMMS_HUB_ENABLED=true`, then redeploy or restart AIMS.
8. Verify `/readyz`, `/comms-hub/health` and authenticated `/comms-hub/diagnostics`.
9. Configure all three Jotform webhooks to the exact ingress route.

## Environment boundaries

- `ONECOM_INFO_PASSWORD` maps later to Koyeb secret `info-Jonathan-harris`.
- `ONECOM_NEWSLETTER_PASSWORD` maps later to `newsletter-Jonathan-harris`.
- `ONECOM_ADMIN_PASSWORD` maps later to `admin-Jonathan-harris`.
- These password variables are not read by the Jotform service.
- Facebook, Instagram and YouTube DM/comment handling remains owned by Zernio configuration until its adapter is built.

## Changed paths

- `.env.example` (modified)
- `README.md` (modified)
- `config/production.defaults.env` (modified)
- `deployment-check.js` (modified)
- `env.template` (modified)
- `package.json` (modified)
- `routes/index.js` (modified)
- `scripts/commsHubMigrate.js` (added)
- `scripts/koyebEnvDoctor.js` (modified)
- `scripts/startupCheck.js` (modified)
- `server.js` (modified)
- `services/comms-hub/README.md` (added)
- `services/comms-hub/clients/d1Client.js` (added)
- `services/comms-hub/clients/jotformClient.js` (added)
- `services/comms-hub/clients/retry.js` (added)
- `services/comms-hub/config.js` (added)
- `services/comms-hub/domain/ids.js` (added)
- `services/comms-hub/domain/redaction.js` (added)
- `services/comms-hub/domain/submission.js` (added)
- `services/comms-hub/domain/webhook.js` (added)
- `services/comms-hub/errors.js` (added)
- `services/comms-hub/index.js` (added)
- `services/comms-hub/intakeService.js` (added)
- `services/comms-hub/migrations/0001_comms_hub.sql` (added)
- `services/comms-hub/migrations/manifest.js` (added)
- `services/comms-hub/repositories/commsRepository.js` (added)
- `services/comms-hub/routes/index.js` (added)
- `services/comms-hub/runtime.js` (added)
- `services/comms-hub/workers/archiveWorker.js` (added)
- `services/shared/middleware/suiteAuth.js` (modified)
- `services/shared/utils/r2-client.js` (modified)
- `test/comms-hub-archive-worker.test.js` (added)
- `test/comms-hub-clients.test.js` (added)
- `test/comms-hub-domain.test.js` (added)
- `test/comms-hub-intake-service.test.js` (added)
- `test/comms-hub-integration-contract.test.js` (added)
- `test/comms-hub-repository.test.js` (added)
- `test/comms-hub-routes.test.js` (added)
- `test/suite-auth.test.js` (modified)
