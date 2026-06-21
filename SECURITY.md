# AIMS security policy

**Status:** Production-controlled  
**Last reviewed:** 21 June 2026

AIMS is an authenticated background API. Store all API keys, provider tokens, webhook secrets and R2 credentials in Koyeb Secrets. Do not expose them through client-side JavaScript, logs, fixtures, reports or committed environment files.

## Production controls

- Suite authentication uses `AIMS_API_KEY` as the canonical bearer token. `AI_SUITE_API_KEY` is accepted only as a backwards-compatible fallback.
- Audit callbacks validate `AUDIT_CALLBACK_TOKEN` or the documented audit callback bearer route.
- `POST /cloudflare/purge` is closed in production unless a valid AIMS bearer token or `x-cloudflare-purge-secret: <CLOUDFLARE_PURGE_SHARED_SECRET>` is supplied. `CLOUDFLARE_PURGE_ALLOW_PUBLIC=true` is an explicit legacy escape hatch and should not be used for paid production.
- `POST /blotato/shorts/:lane/publish-now` is closed in production unless a valid AIMS bearer token or `x-blotato-publish-secret: <BLOTATO_PUBLISH_WEBHOOK_SECRET>` is supplied. `BLOTATO_ALLOW_PUBLIC_PUBLISH_HOOKS=true` is an explicit legacy escape hatch and should not be used for paid production.
- `GET /health`, `GET /livez`, `GET /readyz`, service health endpoints and `GET /blotato/jobs/:sessionId` remain intentionally public.
- CORS is allow-listed, request bodies are bounded, noisy probes are rejected early and rate limits apply to non-health traffic.
- Production readiness fails closed when suite auth or durable R2-backed state is missing.
- Cloudflare R2 object keys are normalised and rejected when they contain traversal segments, absolute paths, control characters, query strings or fragments.
- Production responses must not expose stack traces, raw provider prompts, credentials, bearer tokens, API keys, webhook tokens or signed URLs.
- Containers run as the non-root `node` user and build-time checks are isolated from runtime secrets.

## Secret handling

Production secrets belong in Koyeb Secrets. Use placeholder names in docs only, for example `{{secret.AIMS_API_KEY}}`. Rotate API tokens after suspected exposure and update the matching Koyeb secret.

## Vulnerability reporting

Report vulnerabilities privately to the repository owner with endpoint, impact, reproducible evidence and whether the issue can trigger publishing, destructive cache purges, audit dispatches, email/outreach side effects or state corruption.
