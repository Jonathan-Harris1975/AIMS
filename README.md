# AIMS

AIMS is the production orchestration and content-operations service for Jonathan Harris's publishing ecosystem. It coordinates RSS ingestion, editorial generation, social publishing, blog production, podcast production, artwork, TTS, AI Edge newsletter delivery, audits, outreach and operational sequencing.

This README documents the live repository state only.

## Runtime

- **Platform:** Node.js / Express
- **Production entry point:** `scripts/bootstrap.js` via `npm start`
- **HTTP server:** `server.js`
- **Mounted route registry:** `routes/index.js`
- **Default production timezone:** `Europe/London` where scheduling or date-sensitive content requires a timezone
- **Primary AI gateway:** OpenRouter, with task-specific model configuration
- **Primary object storage:** Cloudflare R2
- **Authentication:** suite bearer authentication for the mounted service router

## Live service groups

| Prefix | Service | Responsibility |
|---|---|---|
| `/rss` | RSS | Feed acquisition, filtering, rewrite, validation and feed publication |
| `/script` | Podcast script | Episode research synthesis, script composition, editorial pass, transcript and metadata |
| `/tts` | TTS | Speech generation, chunking, merge, edit and podcast audio mastering |
| `/artwork` | Artwork | Blog, podcast and direct image generation |
| `/podcast` | Podcast pipeline | End-to-end Turing's Torch production orchestration |
| `/outreach` | Outreach | Prospect discovery, enrichment, validation, scoring and batch state |
| `/blog` | Blog | Weekly article, daily blog-social content and blog RSS publication |
| `/cloudflare` | Cloudflare | Cache purge and site-shell synchronisation |
| `/zernio` | Zernio | Evergreen social, ebook, quiz, mini-series and podcast-promo scheduling |
| `/blotato` | Blotato | Short-form video generation, rendering and platform publication |
| `/audits` | Audits | Website, content, social, newsletter and monthly audit orchestration |
| `/rss-links` | RSS links | R2-backed short-link creation and redirects |
| `/ops` | Operations | Operational windows, preflight, warmup and excellence checks |
| `/newsletter` | AI Edge | Newsletter generation, council QA, storage and Brevo delivery |

## Operational sequencing

`services/ops/index.js` owns the weekday operation windows invoked by MAST. Tasks within a window execute sequentially with the configured delay and timeout controls.

### AM windows

Monday includes RSS rewrite, outreach, blog social, weekly blog, AI Edge generate/send, Monday Zernio, weekly ebook, weekly quiz and Blotato AutoShorts.

Tuesday through Friday include RSS rewrite, outreach, blog social, AI Edge generate/send, the matching Zernio daily lane and Blotato AutoShorts.

AI Edge operational execution is controlled by `AIMS_OPERATION_NEWSLETTER_ENABLED`.

### PM windows

- Monday: Blotato `news-insight`
- Tuesday: Blotato `model-verdict`
- Wednesday: Blotato `ai-at-work`
- Thursday: Blotato `reality-check`
- Friday: Blotato `ai-playbook`, podcast production, Saturday Zernio scheduling, Sunday Zernio scheduling

Friday therefore prepares the weekend Zernio content before weekend standby.

## Monthly audits

The monthly audit routes are under `/audits/monthly`. They are Saturday-gated in Europe/London unless an explicit force override is supplied. AIMS owns audit sequencing and the RAMS handoff contract.

The live top-level monthly endpoints are:

- `POST /audits/monthly/website`
- `POST /audits/monthly/aims`

Audit work is separated from normal Monday-Friday operational windows.

## Content governance

AIMS uses deterministic validators plus specialist AI review for public content. The shared content-quality layer enforces source integrity, British English, Jonathan Harris voice, anti-hype rules, structural quality and format-specific constraints. Specialist councils add channel-specific checks for social, shorts, blog, transcript and AI Edge output.

The master content audit produces consolidated machine- and human-readable artefacts for RAMS and review workflows.

## Models

Task-specific model selection is configured through the production environment and service configuration rather than hard-coded into one universal model. High-reasoning editorial and council work, fast structured tasks, summaries and image generation can use separate model classes. OpenRouter fallbacks are controlled centrally.

## Storage

R2 bucket aliases are configured through `R2_BUCKET_*` and `R2_PUBLIC_BASE_URL_*` variables. The active system stores podcast audio, transcripts, blog output, blog images, RSS feeds, artwork, audit artefacts, metadata, intermediate audio and HIVE skill artefacts in dedicated buckets according to service responsibility.

## HIVE skills

AIMS reads its central HIVE skills manifest in read-only mode. The configured manifest path is `manifests/aims-skills-manifest.json`. HIVE supplies controlled capability/configuration context; AIMS owns runtime orchestration.

## Authentication and external triggers

The mounted service router applies `requireAimsBearerAuth`. Narrow service-specific secrets may also protect externally triggered publication or purge routes. Public exceptions are limited to routes intentionally designed for status or redirects.

## Reliability

- Internal operation tasks have bounded timeouts.
- Service retries use bounded attempts and backoff.
- Failed content QA blocks publication.
- Async jobs expose status endpoints where long-running work requires polling.
- Hookdeck dedupe is used on triggerable workflows that require duplicate protection.
- Operational health/preflight endpoints expose readiness without returning secret values.

## Development verification

```bash
npm ci
npm test
npm run build
npm run check:startup
npm run env:doctor
```

Production install uses:

```bash
npm run deploy:install
```

## Repository documentation

- `services/README.md` — live service catalogue
- `audits/README.md` — audit system and RAMS handoff
- `services/shared/README.md` — shared runtime components
- `services/shared/utils/README.md` — shared utilities and contracts
- Each service directory contains its own operational README.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
