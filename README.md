# AI Management Suite (AIMS)

AIMS is the orchestration and quality-control service for Jonathan Harris's automated content, communications and audit workflows. It is a Node.js/Express application with authenticated service routes, governed content pipelines, durable R2-backed state and operational windows triggered by MAST.

This document describes the current repository implementation and operating contract.

## Runtime

- **Node.js:** 22.x
- **Entry point:** `server.js`
- **Production start:** `npm start`
- **Direct server start:** `npm run start:server`
- **Route registry:** `routes/index.js`
- **Configuration:** `config/production.defaults.env`, `env.template`, `config/thresholds.js`, then service-local configuration
- **Durable storage/state:** Cloudflare R2 where persistence is required
- **Primary model gateway:** OpenRouter

All routes mounted through `routes/index.js` are protected by the AIMS bearer-auth middleware unless a narrower public contract is explicitly implemented elsewhere.

## Mounted service groups

| Prefix | Responsibility |
|---|---|
| `/rss` | RSS ingestion, rewriting and publication |
| `/script` | Podcast script and transcript generation |
| `/tts` | AWS Polly speech generation and audio processing |
| `/artwork` | Image generation and artwork storage |
| `/podcast` | End-to-end Turing's Torch podcast pipeline |
| `/outreach` | Lead discovery, enrichment and governed outreach batching |
| `/blog` | Weekly blog, daily social-blog content and blog RSS |
| `/cloudflare` | Cache purge and website shell synchronisation |
| `/zernio` | Daily social posts, quiz, eBooks, mini-series and Thursday podcast promotion |
| `/blotato` | Short-form video generation, rendering and social publishing |
| `/audits` | Website, AIMS and content audit orchestration |
| `/rss-links` | R2-backed short links and redirects |
| `/ops` | Governed weekday operation windows and readiness |
| `/newsletter` | AI Edge generation, QA and Brevo delivery |
| `/comms-hub` | Email, forms, social conversations, website chat and operator workflows |

`services/api/` contains an internal aggregate router but is not mounted by the production route registry.

## Governed operating windows

AIMS owns task order inside six MAST-triggered operation windows:

- **Monday to Friday AM:** RSS first, then the day's content lanes and dependent publishing steps.
- **Monday AM:** also runs the weekly blog, weekly quiz and scheduled eBook lane.
- **Friday AM:** prepares Friday plus weekend Zernio content and the Friday `ai-playbook` Blotato lane.
- **Friday PM:** podcast readiness followed by the podcast pipeline only.

The operation runner waits for accepted asynchronous Blotato and podcast jobs to become terminal. `202 Accepted` is not treated as completion. Failed or partially failed child work keeps the operation unsuccessful.

Current sequencing is defined in `services/ops/index.js`. MAST owns the clock; individual content routes remain manual recovery controls rather than independent schedules.

## Content and publishing controls

### Zernio

The Zernio service has seven daily lanes plus the weekly quiz pair, weekly mini-series, Tuesday/Thursday/Saturday eBook promotion, blog-RSS social hand-off and Thursday Turing's Torch promotion. It uses source/topicality gates, British English checks, review councils, duplicate protection, schedule verification and image QA before external scheduling.

### Blotato

Five weekday PM-style lanes are implemented: `news-insight`, `model-verdict`, `ai-at-work`, `reality-check` and `ai-playbook`. AutoShorts uses a 48-style rotation. Finished media is checked before publishing, and production defaults require confirmation for every required configured channel.

### Weekly and daily blog

Weekly articles require a clear thesis, original judgement, source grounding, British English and the Jonathan Harris editorial voice. Daily social-blog packages are tied to supplied RSS evidence, must preserve source/link integrity and pass the shared content-quality and council gates before publication.

### Podcast

The Friday pipeline covers script, editorial review, artwork, TTS/audio processing, transcript/metadata, RSS publication and website refresh. The current duration policy targets approximately 50 minutes with a hard upper limit of 70 minutes and audio fitting when needed.

### Newsletter

AI Edge generation and sending are implemented. The weekday operation windows call `/newsletter/generate` and then `/newsletter/send`; the send route performs provider/list/sender checks itself. `/newsletter/readiness` remains available as an explicit diagnostic endpoint. Production defaults currently enable the newsletter operation, while Brevo list creation is disabled and an existing configured audience list is expected.

## Comms Hub

Comms Hub is part of the AIMS process and is mounted at `/comms-hub`. The current code covers:

- the `info@jonathan-harris.online` one.com email lane;
- Jotform intake and governed form processing;
- first-party CogniPal website chat;
- Facebook/Instagram DMs;
- Facebook/Instagram/YouTube comments;
- AI analysis, Smart Response rules, approvals and human takeover;
- attachment quarantine, malware scanning and private R2 promotion;
- delayed substantive email/Jotform replies, 2-3 calendar days later and only Monday-Friday 09:00-17:00 Europe/London;
- podcast/case-study contribution state and editorial-brief queues;
- provider health, follow-up and backup/restore support.

The podcast contribution state machine exists, but post-publication follow-up is still advanced through workflow actions rather than being automatically coupled to a successful podcast publication event. See `services/comms-hub/README.md`.

## Audits and RAMS hand-off

AIMS orchestrates the final website and content audit artefacts and can hand exact R2 JSON keys to RAMS for governed remediation. The content master audit includes editorial, authority, platform, podcast, eBook, artwork and commercial checks. Production evidence is still required before a final content-system audit can be considered complete.

## Local verification

```bash
npm ci
npm run verify
npm run env:doctor:file -- env.template
```

FFmpeg and FFprobe are required for audio/media workflows. Production durable-state paths also require the configured R2 credentials and bucket aliases.

## Configuration rules

- Keep secrets in the deployment secret store, never in committed environment files.
- Treat unresolved `{{ secret.* }}` placeholders as missing configuration.
- Retry transient provider/network failures only; validation and policy failures fail closed.
- Preserve request deduplication and scheduling claims on externally triggered workflows.
- Do not weaken final content or media QA merely because an upstream model/provider call succeeded.
- Use the configured private/public R2 lanes rather than inventing service-local storage contracts.

## Documentation

- [Audits](audits/README.md)
- [Services](services/README.md)
- [Artwork](services/artwork/README.md)
- [Blog](services/blog/README.md)
- [Blotato](services/blotato/README.md)
- [Comms Hub](services/comms-hub/README.md)
- [Newsletter](services/newsletter/README.md)
- [Operations](services/ops/README.md)
- [Outreach](services/outreach/README.md)
- [Podcast](services/podcast/README.md)
- [RSS feed creator](services/rss-feed-creator/README.md)
- [Podcast RSS support](services/rss-feed-podcast/README.md)
- [RSS links](services/rss-links/README.md)
- [Script service](services/script/README.md)
- [Shared runtime](services/shared/README.md)
- [TTS](services/tts/README.md)
- [Zernio](services/zernio/README.md)
- [Comms Hub D1 data plane](workers/comms-hub-data-plane/README.md)
