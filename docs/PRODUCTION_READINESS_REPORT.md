# AIMS production readiness evidence report

**Generated:** 21 June 2026  
**Health-contract clarification:** 23 August 2026
**Status:** Repository-level production readiness passed. Live production certification still requires Koyeb deployment verification.

## Summary

This pass hardened AIMS around the areas most likely to be challenged by senior reviewers: hidden test coverage gaps, production auth gaps on external triggers, durable-state readiness checks, R2 object-key safety, env consistency and deployment documentation.

## Key changes

- Expanded `npm test` and CI to run the full deterministic Node test suite instead of a small smoke subset.
- Repaired stale tests around the central HIVE R2 skill pool.
- Normalised OpenRouter fallback routes to current provider IDs while preserving legacy env aliases.
- Closed production access to Blotato publish-now triggers unless AIMS bearer auth or `BLOTATO_PUBLISH_WEBHOOK_SECRET` is supplied.
- Closed production access to Cloudflare purge unless AIMS bearer auth or `CLOUDFLARE_PURGE_SHARED_SECRET` is supplied.
- Hardened `/readyz` so production readiness checks the same suite-auth key used by middleware and requires complete R2 durable-state configuration.
- Added R2 object-key validation and regression tests for traversal, absolute path, query, fragment and control-character rejection.
- Updated env templates, production defaults, operations docs and service READMEs to match actual production behaviour.

## Verification evidence

| Command | Result |
|---|---|
| `node --version` | `v22.16.0` |
| `npm --version` | `10.9.2` |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed |
| `npm run build` | Passed, `✅ Build check passed` |
| `npm test` | Passed, `236/236` tests |
| `npm run verify` | Passed, `236/236` tests plus build check |
| `npm audit --omit=dev --audit-level=high` | Passed, `found 0 vulnerabilities` |
| `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` | Passed, production dependency install completed |
| `npm run deploy:smoke` | Passed, server started and `/health` returned OK |
| `node scripts/startupCheck.js` | Passed with expected local warnings for missing live R2 credentials |
| `node scripts/koyebEnvDoctor.js env.template` | Passed |
| `node scripts/koyebEnvDoctor.js .env.example` | Passed |
| `node scripts/koyebEnvDoctor.js config/production.defaults.env` | Passed |
| `node deployment-check.js` with safe production-like env | Passed, `✅ Environment validation passed` |
| `find . -name '*.js' -not -path './node_modules/*' -print0 | xargs -0 -n1 node --check` | Passed |
| `docker build` / `docker run` | Not run locally, Docker is not installed in the execution environment. CI retains Docker build coverage. |

## Live verification still required

- Koyeb deployment health for `/health`, `/livez` and `/readyz`.
- Public bounded `/ops/health` and authenticated `/ops/excellence` against the live service.
- Live R2 read/write/list/delete against production buckets.
- Live OpenRouter provider routing and fallback with production API key.
- Live Blotato, Zernio, Cloudflare purge, GitHub audit dispatch and podcast/TTS credentials where those lanes are enabled.
- Docker build/run in GitHub Actions or another Docker-capable runner.
