> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# AI Management Suite (AIMS)

AIMS is the production orchestration API for content, podcast, outreach, social publishing, audits and operational automation. It runs as a Node.js service on Koyeb and is triggered by MAST, Hookdeck and governed operator workflows.

## Production responsibilities

- Podcast composition, TTS, artwork, metadata and publishing workflows.
- Blog, RSS and social-content generation with brand and quarantine gates.
- OneUp and Blotato publishing lanes.
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
npm run verify
```

## Production deployment

Use the root Dockerfile with Node.js 22. The container runs as the non-root `node` user, validates the build without production secrets, and uses `dumb-init` for signal handling. Keep runtime secrets in Koyeb Secrets and validate them with `npm run env:doctor` before deployment.

AIMS should be treated as an internal API. CORS is allow-listed, request bodies are bounded, noisy probes are rejected early and production responses carry restrictive security headers.

See [`SECURITY.md`](SECURITY.md), [`docs/OPERATIONS.md`](docs/OPERATIONS.md) and the service-level READMEs under `services/`.
