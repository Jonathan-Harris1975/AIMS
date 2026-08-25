# AIMS production readiness evidence report

**Generated:** 25 August 2026  
**Status:** Repository-level hardening completed. Live production certification remains contingent on a clean dependency install and credentialled deployment/provider verification.

## Summary

This pass focused on the AIMS Comms Hub production path without changing its intended architecture. It closed request-lifecycle accounting, worker-drain, migration-regression, environment-template, Compose, Koyeb attestation and podcast publication hand-off gaps. It also added a regression guard for the Comms Hub AI control stack so security, evidence, routing, model escalation, validation and approval layers cannot silently disappear from the production path.

## Key changes

- Count each HTTP request exactly once across `finish`/`close` and allow workers a 25-second application shutdown window.
- Drain active Comms Hub pollers/actions during shutdown and surface initial/tick worker failures instead of swallowing them.
- Keep the automatic Comms Hub migration test aligned to the authoritative migration manifest and include it in the normal test command.
- Make the committed environment templates pass the repository env doctor and remove the unused `COMMS_HUB_ONECOM_ACCOUNT_KEY` readiness requirement.
- Replace the stale Repo Management Suite Compose definition with the AIMS runtime image and `/readyz` health contract.
- Require Koyeb deployment attestation to prove the expected Git SHA; `sleeping` is not accepted as production healthy and missing watcher credentials fail closed.
- Couple successful podcast RSS + website publication to the existing accepted-contribution workflow before editorial queue consumption.
- Require the current podcast session to be publication-ready and to expose a canonical HTTPS episode URL before RSS publication can be reported as successful.
- Enforce generated environment-reference drift through `npm run verify`.
- Add a source-level regression test for the complete Comms Hub AI control stack and resilient model routing.

## Verification evidence from this pass

| Command / check | Result |
|---|---|
| `node --version` | `v22.16.0` |
| `npm --version` | `10.9.2` |
| `npm run build` | Passed: 410 source modules checked, 337-module production import graph passed |
| `node --test docs/comms-hub-auto-migration.test.js test/comms-hub-production-control-stack.test.js` | Passed: 10/10 tests |
| `node scripts/envReference.js --write && node scripts/envReference.js --check` | Passed |
| Env doctor: `.env.example` | Passed |
| Env doctor: `env.template` | Passed |
| Env doctor: `services/comms-hub/env.template` | Passed |
| Env doctor: `config/production.defaults.env` | Passed |
| `npm run secret:scan` | Passed |
| `npm run r2:policy:check` | Passed: 19 buckets classified |
| Python compile: Koyeb watcher + notifier | Passed |
| Koyeb exact-SHA/sleeping attestation assertions | Passed |
| Changed JavaScript syntax checks | Passed |
| `docker-compose.yml` YAML parse | Passed |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | Blocked by unavailable npm cache (`zod-3.25.76.tgz`) |
| RSS contract test requiring AWS SDK | Not runnable in this runner because the dependency install is incomplete |

## AI / LLM production control stack

The Comms Hub production path is guarded in this order: prompt-injection scan, conduct assessment, smart conversation context, live-content context, triage, deterministic priority calculation, workflow routing, moderation, approved-evidence retrieval, evidence injection rejection, response intelligence, complexity classification, complex-model escalation where required, output security scan, outbound URL allow-list validation, human-approval policy and follow-up gating.

The shared AI requester adds strict JSON response mode for structured Comms calls, Comms-specific OpenRouter data-collection denial/ZDR routing, bounded timeout/abort handling, `Retry-After` handling, empty-completion detection, compatibility fallback and cross-provider failover. Security, evidence or context escalation remains fail-closed to human review.

## Live verification still required

A clean runner with registry access must complete `npm ci`, `npm run verify`, `npm audit --omit=dev --audit-level=high`, `npm run deploy:smoke` and the Docker build/run. Production certification also requires the real Koyeb, Cloudflare/R2, one.com, Jotform, Zernio, OpenRouter and other enabled-provider credentials so live provider paths can be exercised.
