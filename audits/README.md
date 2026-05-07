# Audits service

## Status

**Implemented.** This page documents behaviour backed by files in `audits/`.

## Purpose

Dispatches external GitHub Actions audits for Mobile UX and SEO/AEO/GEO, receives secure callbacks, runs SEO/AEO/GEO AI analysis jobs, and runs a local on-brand audit over generated content evidence.

## Routes

- `GET /audits/mobile-ux/health`
- `POST /audits/mobile-ux/run`
- `POST /audits/mobile-ux/callback` with audit callback token
- `GET /audits/mobile-ux/jobs/:sessionId`
- `GET /audits/seo-aeo-geo/health`
- `POST /audits/seo-aeo-geo/run`
- `POST /audits/seo-aeo-geo/analysis` with audit callback token
- `GET /audits/seo-aeo-geo/analysis/:sessionId` with audit callback token
- `POST /audits/seo-aeo-geo/callback` with audit callback token
- `GET /audits/seo-aeo-geo/jobs/:sessionId`
- `GET /audits/on-brand/health`
- `POST /audits/on-brand/run`

## Main files

- `audits/index.js` mounts audit routers.
- `audits/routes/mobileUx.js`, `seoAeoGeo.js`, `onBrand.js` define route behaviour.
- `audits/utils/orchestrator.js` dispatches GitHub workflows and tracks jobs.
- `audits/utils/githubDispatch.js` calls GitHub workflow dispatch and verifies workflow runs.
- `audits/utils/publishAuditArtifacts.js` writes audit request/latest/report objects to R2.
- `audits/utils/seoAeoGeoAnalysis.js` performs forensic AI analysis.
- `audits/utils/onBrandAudit.js` and `onBrandEvidence.js` collect and report on-brand evidence.
- `audits/utils/callbackAuth.js` protects callback/analysis endpoints.

## Workflow

- Run routes validate request bodies using shared Zod schemas.
- Mobile UX dispatches `mobile-ux-hard-gate.yml`.
- SEO/AEO/GEO dispatches `seo-aeo-geo-forensic.yml`.
- Callbacks and analysis URLs are built from `AUDIT_CALLBACK_BASE_URL` or `APP_URL`.
- Callbacks require bearer token or `x-audit-callback-token`.
- Completed audit artefact URLs are checked against `R2_PUBLIC_BASE_URL_AUDITS`.
- On-brand audits run inside this application and publish JSON/HTML outputs unless dry-run mode is used.

## Environment variables

- `AUDIT_CALLBACK_TOKEN` or `AI_SUITE_AUDIT_CALLBACK_TOKEN`
- `AUDIT_CALLBACK_BASE_URL` or `APP_URL`
- `AUDIT_WEBSITE_REPO_OWNER`, `AUDIT_WEBSITE_REPO_NAME`, `AUDIT_WEBSITE_REPO_REF`
- `GITHUB_TOKEN_WEBSITE_AUDITS`
- `R2_BUCKET_AUDITS`, `R2_PUBLIC_BASE_URL_AUDITS`
- Shared R2 credentials and `R2_BUCKET_META_SYSTEM` for durable state
- `AI_MODEL_AUDIT`, `AUDIT_AI_*`, `ON_BRAND_AUDIT_*`

## External integrations

- GitHub Actions API
- OpenRouter through shared AI service
- Cloudflare R2 audits bucket
- OneUp API for on-brand evidence when enabled

## Storage

- Audit requests: `<reportPrefix>/request.json`.
- Latest pointers: `audits/<auditType>/latest.json`.
- Analysis/report artefacts are written under the audit report prefix in the R2 audits bucket.
- Job state uses shared durable state when configured.

## Tests

- `test/audit-analysis-route.test.js`
- `test/audit-callback-auth.test.js`
- `test/audit-forensic-analysis-shape.test.js`
- `test/mobile-ux-audit-service.test.js`
- `test/on-brand-audit.test.js`

## Common troubleshooting

- 401 on callback: token mismatch or missing token env.
- Dispatch failure: check GitHub token, repo owner/name, workflow ID and ref.
- Analysis not visible: check job status endpoint and R2 audit artefacts.
- Artefact rejected: URL is outside `R2_PUBLIC_BASE_URL_AUDITS`.

## Connections to other services

Uses shared job store, shared request schemas, shared OpenRouter AI service, shared R2 client and OneUp/RSS/transcript evidence sources for on-brand audits.
