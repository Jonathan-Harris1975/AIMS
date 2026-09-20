# AIMS Remediation Report

**Repository:** AIMS (`AIMS-main`)  
**Remediation date:** 21 September 2026  
**Canonical repository identity:** `AIMS`

## Outcome

Repository-controlled release verification has been strengthened so that migration safety, communications reliability, production health/liveness/readiness behaviour, graceful shutdown, container non-root/filesystem checks, fresh dependency auditing and image vulnerability/secret scanning are explicit release gates.

The supplied execution shell cannot provide final production sign-off because it is not the repository-declared toolchain, outbound npm registry access did not complete, Docker is unavailable, and live provider credentials/infrastructure were not supplied. Those limitations are recorded as external verification requirements rather than application PASS results.

## Files changed

| File | Root cause / change |
|---|---|
| `.github/workflows/ci.yml` | The release workflow did not explicitly gate on the new migration regression suite or container vulnerability/secret scanning. CI now performs the canonical `npm ci`, runs `npm run verify:release`, verifies the image runtime user/filesystem contract, exercises fail-closed production smoke behaviour, and scans both AIMS and Headroom images with an immutable Trivy Action SHA. |
| `package.json` | Operators and CI lacked a single reproducible release-verification command plus explicit migration and communications reliability gates. Added `test:migrations`, `test:comms:reliability` and `verify:release`. |
| `scripts/deploySmoke.js` | Production smoke only checked `/health`. It now checks `/health`, `/livez`, `/readyz`, readiness-status consistency, optional expected-ready/expected-degraded behaviour, graceful shutdown and refusal of requests after shutdown. |
| `test/comms-hub-migration-release-gate.test.js` | Migration verification was primarily mocked. Added an isolated real-SQLite release gate covering clean initialisation, idempotency, upgrade from migration 0020, preservation of communication state, notification-delivery backfill, failed-migration rollback semantics and retry/resume. |
| `docs/RELEASE_VERIFICATION.md` | Added the canonical release procedure, migration/communications gate descriptions, production smoke contract, container gate and exact external staging procedures. |
| `docs/ENVIRONMENT_REFERENCE.md` | Regenerated after adding `DEPLOY_SMOKE_EXPECT_READY` to the smoke verifier. |
| `AIMS_REMEDIATION_REPORT.md` | Records implemented changes, commands actually executed, results and remaining external verification. |

## Commands actually run

| Command / check | Result |
|---|---|
| `node --version` | **LIMITATION** — `v22.16.0`; repository requires `22.22.3`. |
| `npm --version` | **LIMITATION** — `10.9.2`; repository requires `10.9.8`. |
| `docker --version` | **NOT AVAILABLE** — Docker is not installed in this shell. |
| clean `npm ci` attempts | **BLOCKED** — registry-backed clean installs did not complete before execution/network timeouts. A partial `node_modules` tree is not used as production evidence. |
| `npm ping --registry=https://registry.npmjs.org/` (30-second bounded probe) | **BLOCKED** — timed out (`124`). |
| `npm ls --package-lock-only --all` | **PASS** — committed lock graph parses successfully. |
| `npm run test:migrations` | **PASS** — 10/10 tests passed, including 3 new real-SQLite migration release tests. |
| `npm run lint` | **PASS** — 593 JavaScript modules parsed; repository text checks passed. |
| `npm run repo:hygiene` | **PASS**. |
| `npm run build` | **PASS** — control-character audit, full relative-import audit and production import graph passed. |
| `npm run env:reference:write` then `npm run env:reference:check` | **PASS** — environment reference regenerated and current. |
| `npm run secret:scan` | **PASS** — no committed literal credentials detected. |
| `.github/workflows/ci.yml` YAML parse | **PASS**. |
| `node --check scripts/deploySmoke.js` | **PASS**. |
| `node --check test/comms-hub-migration-release-gate.test.js` | **PASS**. |
| `npm run test:comms:reliability` | **INVALID ENVIRONMENT / FAIL** — 18 tests passed and 4 failed because the incomplete install lacks `pino`; this is not classified as an application defect. |
| `npm run deploy:smoke` | **INVALID ENVIRONMENT / FAIL** — startup cannot import `dotenv` from the incomplete dependency tree. |
| `npm run verify:release` | **INVALID ENVIRONMENT / FAIL** — reached the full test suite; 532 tests reported, 401 passed, 129 failed and 2 were cancelled. Repeated failures are `ERR_MODULE_NOT_FOUND` for missing installed dependencies such as `pino`. Later release steps were therefore not executed by this command. |
| fresh `npm audit --omit=dev --audit-level=high` | **NOT VALIDLY EXECUTED** — registry access was unavailable and `verify:release` stopped at the dependency-invalid test phase. |
| production container build / runtime / Trivy scans | **NOT RUN LOCALLY** — Docker unavailable. These are now enforced by CI. |
| live D1 migration / provider end-to-end checks | **NOT RUN** — external credentials and production-equivalent infrastructure were not supplied. |

## Repository-controlled gates now enforced

1. Clean canonical install in CI with `npm ci` on Node `22.22.3` / npm `10.9.8`.
2. Full native verification through `npm run verify`.
3. Real-SQLite migration clean/upgrade/idempotency/failure-retry regression gate.
4. Explicit communications reliability regression gate.
5. Production process smoke covering health, liveness, readiness and graceful shutdown.
6. Performance gate.
7. Repository secret scan and fresh registry-backed `npm audit`.
8. Production AIMS and Headroom container builds.
9. AIMS runtime toolchain, non-root user and writable state-path checks inside the built image.
10. High/Critical vulnerability and secret scanning for both built images.
11. Release attestation remains dependent on both application verification and container jobs.

## Remaining externally dependent verification

Run these commands on a clean runner using exactly Node `22.22.3` and npm `10.9.8` with registry access:

```bash
rm -rf node_modules
npm ci
npm run verify:release
```

Then execute the container path, either through the updated GitHub Actions workflow or an equivalent Docker-capable runner:

```bash
docker build -t aims:release .
docker run --rm aims:release node -e 'console.log(process.versions.node)'
docker run --rm -e NODE_ENV=production -e ALLOW_EPHEMERAL_STATE=true -e STATE_BACKEND=local -e DEPLOY_SMOKE_EXPECT_READY=false aims:release npm run deploy:smoke
```

For credentialled production-equivalent staging, require readiness and exercise the live migration path:

```bash
DEPLOY_SMOKE_EXPECT_READY=true npm run deploy:smoke
npm run comms:migrate:status
npm run comms:migrate
npm run comms:migrate:status
```

Finally, exercise every enabled communications provider with non-destructive test identities and verify queue acceptance, dispatch, retry, terminal failure/quarantine, idempotency, duplicate-event protection, timeout/provider-outage handling, durable state, operator-visible errors, worker heartbeat visibility and restart recovery.

## Final status

**Repository changes implemented:** PASS.  
**Repository static/build/migration gates executable in this shell:** PASS.  
**Canonical clean dependency-backed release verification:** NOT VERIFIED in this shell.  
**Container verification:** NOT VERIFIED locally; enforced by updated CI.  
**Credentialled live provider and production-equivalent persistence verification:** EXTERNAL / NOT VERIFIED.

No production-ready PASS is claimed until the canonical clean runner, container job and credentialled staging checks above have completed successfully.
