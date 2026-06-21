# AIMS production operations

**Status:** Paid Koyeb production service  
**Last reviewed:** 21 June 2026

AIMS runs as one non-root Koyeb Web Service with durable R2-backed state and fail-closed production settings. Use `/livez`, `/readyz`, `/ops/health`, `/ops/preflight`, `/ops/warmup` and `/ops/excellence` to distinguish process health, dependency readiness, warmup state and workflow/provider quality.

## Health contract

| Endpoint | Auth | Purpose |
|---|---:|---|
| `GET /health` | Public | Basic service health and build flags. |
| `GET /livez` | Public | Process liveness only. |
| `GET /readyz` | Public | Production readiness checks for suite auth, durable state, R2 and core config. |
| `GET /ops/health` | AIMS bearer | Deeper operational health. |
| `POST /ops/preflight` | AIMS bearer | Governed preflight checks before MAST/HIVE-triggered work. |
| `POST /ops/warmup` | AIMS bearer | Warmup infrastructure for downstream workflows. |
| `GET /ops/excellence` | AIMS bearer | Bounded production telemetry without prompts or secrets. |

## Koyeb deployment contract

- Runtime: Node.js 22, npm 10.
- Build command: `npm ci --ignore-scripts --no-audit --no-fund && npm run build`.
- Start command: `npm start`.
- Health check endpoint: `/health`.
- Readiness endpoint after deployment: `/readyz`.
- Keep all production credentials in Koyeb Secrets. Do not paste real values into `.env.example`, `env.template` or `config/production.defaults.env`.
- `STATE_BACKEND=auto` or `STATE_BACKEND=r2` is required for paid production. `STATE_BACKEND=local` is not production-safe unless `ALLOW_EPHEMERAL_STATE=true` is deliberately set for a disposable test deployment.

## Required production secrets

| Lane | Secret/env key |
|---|---|
| Auth | `AIMS_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| R2 durable state and artefacts | `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| Audit callback | `AUDIT_CALLBACK_TOKEN` |
| GitHub audit dispatch | `GITHUB_TOKEN_WEBSITE_AUDITS` |
| Cloudflare purge | `CF_zone`/`CLOUDFLARE_ZONE_ID`, `CF_purge`/`CLOUDFLARE_PURGE_API_TOKEN`, optionally `CLOUDFLARE_PURGE_SHARED_SECRET` for webhook callers |
| Blotato | `Blotato_API_key`, optionally `BLOTATO_PUBLISH_WEBHOOK_SECRET` for scheduler hooks |
| OneUp | `ONEUP_API_KEY` |
| Zernio | `ZERNIO_API_KEY_META`, `ZERNIO_API_KEY_VIDEO` where monthly reports are enabled |
| Podcast/TTS | AWS/Polly credentials and podcast-index credentials where those lanes are enabled |
| Outreach | Apollo, Hunter, SERP, URLScan and ZeroBounce keys where outreach is enabled |
| HIVE ops alerting | `OPS_ALERT_WEBHOOK_URL`, `OPS_ALERT_WEBHOOK_TOKEN` |

## Required non-secret production values

- `R2_BUCKET_AUDITS=audits`
- `R2_PUBLIC_BASE_URL_AUDITS=https://pub-f6b6cfd7d07e46f695d08e4a8dc3bd6b.r2.dev`
- `R2_BUCKET_HIVE_SKILLS=hive-skills`
- `R2_PUBLIC_BASE_URL_HIVE_SKILLS=https://pub-da50a6512f164566955a3076a1c795ef.r2.dev`
- `BLOTATO_DEFAULT_CHANNELS=instagram,youtube,tiktok,facebook`
- `BLOTATO_REQUIRE_ALL_CHANNELS=false` unless the release explicitly requires all platforms to publish successfully.
- `CLOUDFLARE_PURGE_ALLOW_PUBLIC=false`
- `BLOTATO_ALLOW_PUBLIC_PUBLISH_HOOKS=false`

## Verification commands

Run these before deployment:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
npm run verify
npm audit --omit=dev --audit-level=high
npm run deploy:smoke
node scripts/koyebEnvDoctor.js env.template
```

Run these after Koyeb deploys:

```bash
curl -fsS https://<aims-service>/health
curl -fsS https://<aims-service>/livez
curl -fsS https://<aims-service>/readyz
curl -fsS -H "Authorization: Bearer $AIMS_API_KEY" https://<aims-service>/ops/health
curl -fsS -H "Authorization: Bearer $AIMS_API_KEY" https://<aims-service>/ops/excellence
```

## Partial-run recovery

1. Inspect durable job state, quarantine state and `/ops/excellence`.
2. Identify the last completed step and its idempotency key.
3. Do not replay publishing, email, purge, GitHub dispatch or bulk outreach until downstream state is checked.
4. Resume through the governed route using the same job identifier where supported.
5. Retain state objects, provider IDs, R2 artefact URLs and logs with the release evidence.

## Rollback

1. Roll back to the last known-good Koyeb deployment image or Git commit.
2. Keep the same R2 state buckets unless state corruption is the cause.
3. Re-run `/readyz` and `/ops/health`.
4. Check Blotato, OneUp, audit dispatch and outreach queues for duplicate side effects before replay.
5. Record the rollback in the production evidence report.

Deployment notification and recovery details are in [`OPERATIONAL_ALERTING.md`](OPERATIONAL_ALERTING.md).
