> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Audits service

## Status

**Implemented.** This page documents behaviour backed by files in `audits/`.

## Purpose

Owns the unified website audit pipeline (Digital Growth -> SEO/AEO/GEO -> rendered Mobile UX -> 24-seat council -> PDF/HTML/JSON -> cleanup -> RAMS), while also retaining standalone source-audit routes, the local on-brand audit and monthly Zernio social-performance reporting.

## Routes

- `GET /audits/website/health`
- `POST /audits/website/run`
- `GET /audits/website/jobs/:sessionId`
- `POST /audits/website/jobs/:sessionId/rams/retry`
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
- `GET /audits/social-performance/health`
- `POST /audits/social-performance/run`

## Main files

- `audits/index.js` mounts audit routers.
- `audits/routes/mobileUx.js`, `seoAeoGeo.js`, `onBrand.js`, `socialPerformance.js` define route behaviour.
- `audits/utils/orchestrator.js` dispatches GitHub workflows and tracks jobs.
- `audits/utils/githubDispatch.js` calls GitHub workflow dispatch and verifies workflow runs.
- `audits/utils/publishAuditArtifacts.js` writes audit request/latest/report objects to R2.
- `audits/utils/seoAeoGeoAnalysis.js` performs forensic AI analysis.
- `audits/utils/onBrandAudit.js` and `onBrandEvidence.js` collect and report on-brand evidence.
- `audits/utils/zernioSocialPerformance.js` collects Zernio analytics and writes monthly social-performance JSON/HTML reports to the R2 audits bucket.
- `audits/utils/callbackAuth.js` protects callback/analysis endpoints.

## Workflow

- Run routes validate request bodies using shared Zod schemas.
- Mobile UX dispatches `mobile-ux-hard-gate.yml`.
- SEO/AEO/GEO dispatches `seo-aeo-geo-forensic.yml`.
- Callbacks and analysis URLs are built from `AUDIT_CALLBACK_BASE_URL` or `APP_URL`.
- Callbacks require bearer token or `x-audit-callback-token`.
- Completed audit artefact URLs are checked against `R2_PUBLIC_BASE_URL_AUDITS`.
- On-brand audits run inside this application and publish JSON/HTML outputs unless dry-run mode is used.
- Social-performance reports are analysis-only. They do not post content and set `ramsPolicy.shouldTriggerRams=false` in report outputs.

## Environment variables

- `AUDIT_CALLBACK_TOKEN` or `AI_SUITE_AUDIT_CALLBACK_TOKEN`
- `AUDIT_CALLBACK_BASE_URL` or `APP_URL`
- `AUDIT_WEBSITE_REPO_OWNER`, `AUDIT_WEBSITE_REPO_NAME`, `AUDIT_WEBSITE_REPO_REF`
- `GITHUB_TOKEN_WEBSITE_AUDITS`
- `R2_BUCKET_AUDITS`, `R2_PUBLIC_BASE_URL_AUDITS`
- Shared R2 credentials and `R2_BUCKET_META_SYSTEM` for durable state
- `AI_MODEL_AUDIT`, `AUDIT_AI_*`, `ON_BRAND_AUDIT_*`
- `ZERNIO_META_API_KEY`, `ZERNIO_VIDEO_API_KEY`
- Optional Zernio settings: `ZERNIO_META_PLATFORMS`, `ZERNIO_VIDEO_PLATFORMS`, `ZERNIO_API_BASE_URL`, `ZERNIO_ANALYTICS_SOURCE`, `ZERNIO_ANALYTICS_PAGE_SIZE`, `ZERNIO_ANALYTICS_MAX_PAGES`, `ZERNIO_ANALYTICS_TIMEOUT_MS`
- Optional shorts thumbnail audit: `ZERNIO_THUMBNAIL_AUDIT_ENABLED=true`, `ZERNIO_THUMBNAIL_AUDIT_MAX_POSTS`, `ZERNIO_THUMBNAIL_AUDIT_REQUIRE_PLAYWRIGHT`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`

## External integrations

- GitHub Actions API
- OpenRouter through shared AI service
- Cloudflare R2 audits bucket
- Zernio API for on-brand evidence when enabled
- Zernio Analytics API for monthly social-performance evidence

## Storage

- Audit requests: `<reportPrefix>/request.json`.
- Latest pointers: `audits/<auditType>/latest.json`.

- Unified website report set: `audits/website/YYYY-MM/<pipeline-session>/website-audit.pdf`, `website-audit.html`, and `website-audit.json`. These are the only permanent website-audit artefacts. AIMS passes the exact JSON key to RAMS after verified temporary cleanup.
- Brand-social council reports: `audits/brand-social-council/<timestamp>-<sessionId>/report.html`, `report.json`, `summary.json`, `coverage.json`, and `repository-issue-appendix.json`; latest pointer: `audits/brand-social-council/latest.json`. RAMS may read this as the on-brand master report, but it remains future-guidance/manual-review only unless deterministic file-level evidence is later published.
- Zernio reports: `audits/social-performance/<timestamp>-<sessionId>/report.html`, `report.json`, and `summary.json`. If thumbnail auditing is enabled, `thumbnail-audit.json` is also written beside the report.
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
- Empty Zernio report: confirm both Zernio accounts are connected, API keys are set, and the report date range contains platform posts/analytics.
- Artefact rejected: URL is outside `R2_PUBLIC_BASE_URL_AUDITS`.

## Connections to other services

Uses shared job store, shared request schemas, shared OpenRouter AI service, shared R2 client and Zernio/RSS/transcript evidence sources for on-brand audits.

### Brand & Social Media Performance Council

Routes:

- `GET /audits/brand-social-council/health`
- `POST /audits/brand-social-council/run`

The council combines the latest on-brand and Zernio social-performance reports into one RAMS-readable master report. It adds Brand Editor, Social Performance Analyst, Hook Analyst, Thumbnail & Visual Packaging Expert, Repurposing Lead, Comments & Replies Auditor, Cross-Platform Coherence Lead, Podcast & Transcript Lead, Commercial Lead, and Automation Safety Lead decisions.

Set `BRAND_SOCIAL_COUNCIL_RUN_AFTER_SOCIAL=true` to run it automatically after the monthly social-performance report. Leave false to run it as a separate monthly service.
### Unified Website Audit Council and RAMS handoff

The former standalone SEO/AEO/GEO and Mobile UX councils are retired. Their evidence now feeds the single 24-seat website council inside `websiteAuditCouncil.js`. The source audit callbacks only resume the AIMS parent pipeline; they do not launch separate councils.

The retained website report set is exactly PDF, HTML and JSON. Once all three are published and the temporary evidence prefix is verified empty, AIMS dispatches RAMS pipeline `website` with the exact final JSON R2 key.
