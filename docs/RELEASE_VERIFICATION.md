# AIMS release verification

AIMS release approval is tied to the repository-controlled gates below. The canonical application identity remains `AIMS`; these checks are designed to remain reproducible when HIVE rebuilds Repository Memory and Repository Intelligence from a clean snapshot.

## Canonical toolchain

Use exactly the versions declared by `package.json`:

- Node.js `22.22.3`
- npm `10.9.8`
- the committed `package-lock.json`

Start from a clean dependency tree:

```bash
rm -rf node_modules
npm ci
npm run verify:release
```

`verify:release` runs the normal lint, hygiene, test, build and environment-reference gates, then explicit migration and communications-reliability regression suites, production-process smoke checks, the performance gate, secret scanning and a fresh npm vulnerability audit.

## Migration release gate

`npm run test:migrations` uses an isolated in-memory SQLite datastore to exercise the real Comms Hub migration SQL and runner. It verifies:

- clean initialisation through the complete required migration manifest;
- idempotent re-execution;
- upgrade from an existing deployment at migration `0020`;
- preservation of existing contacts, conversations, messages, aliases and delayed work;
- notification-delivery backfill introduced by migration `0021`;
- a failed migration is not recorded as applied;
- retry resumes from the last committed migration.

The live D1 migration remains an external staging/production check because it requires Cloudflare credentials and a non-destructive production-equivalent database.

## Communications reliability gate

`npm run test:comms:reliability` re-runs the release-critical channel regression set for email, chat, social delivery, durable retry/quarantine behaviour, provider health, worker heartbeats and notification delivery. The full `npm test` suite remains authoritative and runs first through `npm run verify`.

## Production smoke contract

`npm run deploy:smoke` starts AIMS with production semantics and verifies:

- `/health` returns the AIMS health contract;
- `/livez` returns a live process contract;
- `/readyz` returns a self-consistent ready/degraded contract;
- graceful shutdown closes the listener and stops accepting requests.

Set `DEPLOY_SMOKE_EXPECT_READY=true` in a credentialled staging environment to require `/readyz` to pass. Set it to `false` when deliberately testing dependency-unavailable behaviour; readiness must then fail closed. The default `auto` mode validates the contract without forcing either external state.

## Container release gate

GitHub Actions builds the production AIMS and Headroom images from scratch. For AIMS it additionally verifies the pinned Node/npm runtime, configured non-root `node` user, writable `/app/local-data`, and production smoke behaviour.

Both built images are scanned with the immutable `aquasecurity/trivy-action` commit corresponding to v0.36.0. High/Critical vulnerability or secret findings fail the container job. The release gate depends on both the application verification job and the container job, so neither can be bypassed by the other succeeding.

## External production-equivalent checks

Repository CI cannot prove live provider behaviour without credentials. Before production sign-off, run the following in the protected staging/production-equivalent environment:

```bash
DEPLOY_SMOKE_EXPECT_READY=true npm run deploy:smoke
npm run comms:migrate:status
npm run comms:migrate
npm run comms:migrate:status
```

Then exercise enabled communications providers end-to-end using non-destructive test identities and confirm queue acceptance, dispatch, retry, terminal failure/quarantine, duplicate protection, observability, operator-visible alerts and recovery after restart. Do not mark these checks passed unless the credentialled environment actually executed them.
