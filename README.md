> **Document status:** Production reference  
> **Last reviewed:** 21 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# AI Management Suite (AIMS)

AIMS is the production orchestration API for content, podcast, outreach, social publishing, audits and operational automation. It runs as a Node.js service on Koyeb and is triggered by MAST, Hookdeck and governed operator workflows.

## Production responsibilities

- Podcast composition, TTS, artwork, metadata and publishing workflows.
- Blog, RSS and social-content generation with brand and quarantine gates.
- Zernio and Blotato publishing lanes.
- Outreach processing and repository/audit dispatch.
- Durable operational state in Cloudflare R2.
- Operational health and warm-up endpoints consumed by HIVE.

## Health contract

| Endpoint | Purpose |
|---|---|
| `GET /health` | Public service health |
| `GET /livez` | Liveness probe |
| `GET /readyz` | Dependency/configuration readiness |
| `GET /ops/health` | Deeper authenticated operational status where configured |

## Local verification

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
npm run verify
npm audit --omit=dev --audit-level=high
npm run deploy:smoke
```

## Production deployment

Use the root Dockerfile with Node.js 22. The container runs as the non-root `node` user, validates the build without production secrets, and uses `dumb-init` for signal handling. Keep runtime secrets in Koyeb Secrets and validate them with `npm run env:doctor` before deployment.

AIMS should be treated as an internal API. CORS is allow-listed, request bodies are bounded, noisy probes are rejected early and production responses carry restrictive security headers. Production publish-now and purge triggers are not public by default: use the suite bearer token or the documented hook secrets.

See [`SECURITY.md`](SECURITY.md), [`docs/OPERATIONS.md`](docs/OPERATIONS.md) and the service-level READMEs under `services/`.

## Professional operations

`/ops/excellence` reports durable job outcomes, retry recovery and provider latency/failure aggregates. Repeated workflow failures and CI/Koyeb deployment failures are delivered to HIVE-UI Ops. See [`docs/OPERATIONAL_ALERTING.md`](docs/OPERATIONAL_ALERTING.md).


## Production hardening notes

- `npm test` runs the full deterministic Node test sweep, including job-store and every `test/*.test.js` file.
- `/readyz` fails closed in production when `AIMS_API_KEY` or durable R2-backed state is missing.
- `POST /cloudflare/purge` requires AIMS bearer auth or `CLOUDFLARE_PURGE_SHARED_SECRET` in production unless `CLOUDFLARE_PURGE_ALLOW_PUBLIC=true` is deliberately set.
- `POST /blotato/shorts/:lane/publish-now` requires AIMS bearer auth or `BLOTATO_PUBLISH_WEBHOOK_SECRET` in production unless `BLOTATO_ALLOW_PUBLIC_PUBLISH_HOOKS=true` is deliberately set.
- R2 object keys are rejected when they contain traversal, absolute paths, query strings, fragments or control characters.
- AIMS consumes the central HIVE R2 skill pool; it does not auto-deploy local skill descriptors.
