# AIMS audit system

The audit subsystem runs production-quality reviews of the website and publishing ecosystem, produces durable audit evidence and provides structured handoff data for RAMS. It is mounted at `/audits`.

## Audit routes

| Route group | Purpose |
|---|---|
| `/audits/website` | Full website audit, council review, report publication and RAMS handoff controls |
| `/audits/digital-growth` | Growth, conversion and commercial-performance analysis |
| `/audits/seo-aeo-geo` | Search, answer-engine and generative-engine evidence analysis |
| `/audits/mobile-ux` | Mobile UX evidence and scoring |
| `/audits/on-brand` | Brand compliance review |
| `/audits/brand-social-council` | Social-brand council audit |
| `/audits/social-performance` | Social content/performance review |
| `/audits/newsletter` | AI Edge audit |
| `/audits/podcast-website` | Podcast/web integration audit |
| `/audits/content-master` | Cross-channel master content council and RAMS-ready report |
| `/audits/monthly` | Saturday-gated website and AIMS monthly orchestration |

Each long-running audit exposes a health route and, where applicable, a job-status route.

## Master content report

The master content audit consolidates quality findings across social, Blotato shorts, podcast transcripts, podcast metadata/keywords, ebook promotion, newsletter, weekly blog, blog social and hashtag strategy.

The final retained report formats are:

- JSON — authoritative machine-readable RAMS contract
- HTML — browser-readable editorial report
- PDF — fixed human-review artefact

The report contains issue evidence, severity, affected content/repository targets, specialist council findings, repair guidance and the bounded RAMS handoff payload.

## Monthly orchestration

`POST /audits/monthly/website` and `POST /audits/monthly/aims` are restricted to Saturday in `Europe/London` unless `force` is explicitly supplied. This keeps audit/remediation work outside the normal Monday-Friday content operation windows.

AIMS remains the sequencing authority. RAMS work is triggered only after the corresponding audit/report stage reaches its successful terminal state.

## RAMS safety contract

Audit findings are evidence, not permission for broad refactoring. The RAMS handoff is intended for bounded, file-specific remediation. Architecture changes, security-policy changes, secret handling, deployment control and autonomy-policy changes must not be represented as routine micro-fixes.

## Storage

Audit artefacts use the configured audits R2 bucket and public base URL. Job state uses the shared async job/state utilities.

## Core configuration

Important variables include:

- `R2_BUCKET_AUDITS`
- `R2_PUBLIC_BASE_URL_AUDITS`
- `AUDIT_AI_*` retry/token/timeout controls
- `AUDIT_WEBSITE_REPO_OWNER`
- `AUDIT_WEBSITE_REPO_NAME`
- `AUDIT_WEBSITE_REPO_REF`
- `CONTENT_MASTER_COUNCIL_*`
- `CONTENT_AUDIT_TRIGGER_RAMS`
- `BRAND_SOCIAL_COUNCIL_RUN_AFTER_SOCIAL`

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
