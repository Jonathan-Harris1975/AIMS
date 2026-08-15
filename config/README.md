# AI Management Suite

AI Management Suite is a modular Node/Express application for Jonathan Harris’s content automation workflows. The repository currently combines podcast generation, RSS/newsletter rewriting, script generation, text-to-speech processing, artwork generation, blog publishing, social scheduling, outreach lead discovery, audit orchestration, the AIMS Comms Hub, Cloudflare cache purge support, self-hosted RSS short links, shared Cloudflare R2 storage utilities, shared OpenRouter routing, and deployment/test tooling.

This README documents the repository as it exists in code. It separates **implemented**, **partially implemented**, and **present but not wired** areas so maintainers are not chasing phantom routes through the boiler-room fog. 🛠️

## Release 2.9.2: governed morning and podcast operations

This maintenance release verifies the complete weekday morning and Friday podcast hand-off between MAST and AIMS. Accepted Blotato and podcast jobs are polled to terminal state, synchronous body-level failures are honoured, partial platform delivery blocks standby, the Monday mini-series runs exactly once, Friday no longer duplicates the social-blog package, and podcast RSS/site publication failures keep the operation window failed rather than being mistaken for success.

## Release 2.9.0: content reliability and topicality

This release closes the production failures observed on 31 July 2026 across the
newsletter, Zernio, social-blog and Blotato pipelines. The central rule is now
simple: a prompt, script or pre-render score is not proof that the published
artefact is correct. Final copy, final source evidence and final pixels must all
pass their own gates before an external side effect is allowed.

### Newsletter

- Generation and delivery are separate operations.
- `POST /newsletter/readiness` and `GET /newsletter/readiness/:profileId?`
  verify the configured Brevo sender and an existing populated audience list
  without creating or sending anything.
- The operational window runs `newsletter-generate`, then
  `newsletter-readiness`, then `newsletter-send`. A failed readiness check
  blocks delivery rather than producing an opaque downstream send failure.
- Production list creation is disabled by default. Set
  `NEWSLETTER_AI_EDGE_BREVO_LIST_ID` to the existing populated AI Edge list and
  keep `NEWSLETTER_BREVO_ALLOW_LIST_CREATE=false`.
- Newsletter artwork is inspected after generation. Travel/lifestyle drift,
  pseudo-typography, logos, unrelated scenes and weak editorial relevance fail
  before upload.

### Zernio daily posts and weekly mini-series

- Each daily lane has a deterministic topic contract. Saturday must contain a
  genuine AI ethics/policy trade-off and a reasoned debate question; Friday
  must describe a concrete operational lesson, consequence or recovery step.
- A failed semantic gate triggers a materially new model repair using the
  declared topic and supplied source evidence. Repeating the same unchanged
  candidate five times is no longer accepted as a review loop.
- RSS-backed daily posts retain only exact supplied source URLs and must remain
  topically aligned with those sources.
- Mini-series research may skip a weak week. Every planned and generated part
  must cite approved evidence, match its own angle and remain distinct from the
  other parts. The complete series is reviewed before any part is scheduled.
- Social artwork is inspected after generation. Generated labels, pseudo-text,
  infographic panels, decorative dashboards and unrelated generic AI imagery
  are hard failures.

### Daily social-blog posts

- The structured package must select one to three exact URLs from the rewritten
  RSS evidence supplied to the model.
- The title, summary, body, caption and takeaway must represent the selected
  sources rather than merely mentioning generic AI vocabulary.
- Phase 4 and Phase 5 repairs rebuild the title, slug, HTML, manifest and image
  prompt, regenerate artwork when the visual brief changes, and then rerun both
  final gates. Repaired JSON can no longer be returned while stale pre-repair
  HTML is published.
- Empty model completions have a bounded per-provider retry budget and move to
  the next configured provider promptly.

### Blotato shorts

- The finished duration contract is **35 to 55 seconds**, with a default target
  of 45 seconds. Request validation, script calibration and final media checks
  use the same range.
- The finished MP4 is downloaded and checked with FFprobe before scheduling.
- A contact sheet deliberately oversamples the first three seconds and is
  reviewed multimodally for hook strength, source relevance, scene-to-script
  alignment, visual progression, caption legibility and finished visual
  quality.
- Generic desk scenes, decorative AI metaphors, repeated near-identical scenes
  and source-irrelevant visuals fail even when the pre-render script gate scored
  highly.
- Ambiguous “not complete” provider responses remain pending and are polled;
  explicit insufficient-credit responses remain terminal.

### Deployment gate

Before enabling this release in production:

```bash
npm ci
npm test
npm run build
npm run env:doctor:file -- env.template
```

Production also requires FFmpeg and FFprobe, a working image-capable QA route,
the verified Brevo sender, the populated AI Edge list ID, and the existing
Blotato/Zernio credentials. Keep publishing disabled if any readiness or final
artefact gate fails. A technically successful generation is not permission to
publish.

## Documentation index

- [Audits](audits/README.md)
- [Artwork](services/artwork/README.md)
- [Blog](services/blog/README.md)
- [Cloudflare purge](services/cloudflare-purge/README.md)
- [Comms Hub](services/comms-hub/README.md)
- [OneUp](services/oneup/README.md)
- [Outreach](services/outreach/README.md)
- [Podcast](services/podcast/README.md)
- [RSS feed creator](services/rss-feed-creator/README.md)
- [Podcast RSS feed](services/rss-feed-podcast/README.md)
- [RSS links](services/rss-links/README.md)
- [Script generation](services/script/README.md)
- [Shared utilities](services/shared/README.md)
- [TTS](services/tts/README.md)
- [API aggregator status](services/api/README.md)

## Project overview

### What the suite does

The application supports these business/content workflows:

- **Podcast automation**: create a script, generate artwork, synthesize speech, merge/edit/master audio, update episode metadata, rebuild the podcast RSS feed and trigger a website rebuild.
- **RSS/feed rewriting**: fetch configured RSS and URL sources, rewrite selected items using OpenRouter, enforce topic/brand checks, publish `feed.xml` and `feed.json` to R2.
- **Script generation**: generate podcast intro/main/outro text, compose an episode, run an editorial pass, split text into TTS chunks, publish transcript files and episode metadata.
- **TTS/audio production**: use AWS Polly, store MP3 chunks in R2, merge with FFmpeg, edit audio, add intro/outro and upload final podcast MP3.
- **Artwork generation**: generate podcast/blog/direct artwork through OpenRouter image-capable models and store the output in R2.
- **Blog publishing**: build weekly AI briefing posts and daily/social blog posts from rewritten RSS material, generate images, update manifests, publish RSS feeds and trigger website rebuilds.
- **OneUp scheduling**: generate and optionally schedule daily posts, weekly quiz posts and weekly ebook posts to OneUp.
- **Outreach**: scan SERP results for keywords, filter domains, enrich contacts, validate emails, score leads and append accepted rows to Google Sheets.
- **Audits**: AIMS orchestrates the website audit pipeline end-to-end (Digital Growth -> SEO/AEO/GEO -> Mobile UX -> 24-seat expert council -> final PDF/HTML/JSON report set -> temporary artefact cleanup -> RAMS website remediation handoff), while retaining standalone audit routes and the internal on-brand audit.
- **Cloudflare purge**: purge a Cloudflare zone cache using a bearer token, with optional application-level shared-secret protection.
- **RSS short links**: create R2-backed short links and redirect pages for RSS/feed links.

### Runtime model

- Main application entry: `server.js`.
- Production start command: `npm start`, which runs `scripts/bootstrap.js` before importing and starting the server.
- Mounted route registry: `routes/index.js`.
- Services are isolated under `services/*` and `audits/*`, with shared concerns under `services/shared/*`.
- Async long-running jobs use the shared in-process job store with durable persistence when R2 metasystem state is configured.
- Storage-backed services use `services/shared/utils/r2-client.js` and bucket aliases rather than raw bucket names in service code.

## Quick start

### Requirements

- Node.js `>=20 <25` from `package.json`.
- npm with lockfile support.
- FFmpeg and FFprobe are required by startup checks and audio workflows.
- For production durable state, configure R2 credentials and `R2_BUCKET_META_SYSTEM`, unless deliberately setting `ALLOW_EPHEMERAL_STATE=true`.

### Install

```bash
npm ci
```

### Start locally

```bash
npm run start:server
```

This bypasses `scripts/bootstrap.js` and starts `server.js` directly. It is useful for route-level development when FFmpeg/R2 bootstrap checks are not the focus.

### Start with production bootstrap

```bash
npm start
```

`npm start` runs:

1. `scripts/bootstrap.js`
2. Optional RSS feed initialisation when `R2_BUCKET_RSS_FEEDS` is configured
3. `scripts/startupCheck.js`
4. `scripts/tempStorage.js`
5. Optional transcript HTML backfill when `BACKFILL_TRANSCRIPT_HTML=true`
6. `server.js`

### Test

```bash
npm test
```

The test command in `package.json` is:

```bash
node --test job-store.test.js test/*.test.js
```

### Health check

```bash
curl http://localhost:3000/health
```

Expected high-level response:

```json
{
  "ok": true,
  "status": "ok",
  "trustProxy": false
}
```

`trustProxy` depends on `TRUST_PROXY` and `NODE_ENV`.

## Architecture overview

### Express lifecycle

`server.js` creates one Express app and applies middleware in this order:

1. Trust proxy configuration from `TRUST_PROXY`.
2. Noisy probe handling before normal middleware:
   - `/.well-known/acme-challenge/*` returns `204`.
   - `/favicon.ico` redirects to the configured public favicon asset route in code.
   - Common WordPress, Git and scanner paths return `404`.
3. CORS middleware.
4. JSON and URL-encoded body parsers.
5. `pino-http` request logging with request ID support.
6. Shared rate limiting.
7. Root routes `/` and `/health`.
8. Mounted service router from `routes/index.js`.
9. JSON 404 handler.
10. JSON error handler.

### Route registration

`routes/index.js` mounts active routers:

```text
/rss                  routes/rss.js
/rss                  services/rss-feed-creator/routes/rewrite.js
/script               services/script/routes/index.js
/tts                  services/tts/routes/tts.js
/artwork              services/artwork/index.js
/podcast              services/podcast/index.js
/outreach             services/outreach/routes/index.js
/blog                 services/blog/index.js
/cloudflare           services/cloudflare-purge/index.js
/oneup                services/oneup/index.js
/audits               audits/index.js
/rss-links            services/rss-links/index.js
/comms-hub            services/comms-hub/index.js
```

### Middleware and operational behaviour

| Concern | Evidence | Behaviour |
|---|---|---|
| Logging | `logger.js`, `server.js` | Pino logger. Production logging is JSON when `NODE_ENV=production`; development uses `pino-pretty`. |
| Request IDs | `server.js` | Uses `x-request-id`, Idempotency headers, or `crypto.randomUUID()`. Response header `x-request-id` is set. |
| CORS | `server.js` | `CORS_ORIGINS` comma-separated allow-list. Without configured origins, non-production allows loopback origins. Server-to-server/no-origin requests are allowed. |
| Body limits | `server.js` | `JSON_BODY_LIMIT` and `URLENCODED_BODY_LIMIT`, default `10mb`. |
| Rate limiting | `services/shared/middleware/rateLimit.js` | Enabled by default in production, disabled by default outside production unless configured. Skips `/` and `/health`. Uses IP + method. |
| Error handling | `server.js` | Invalid JSON `400`, body too large `413`, aborted requests `400`, CORS denied `403`, otherwise `500`, always JSON with request ID where available. |
| Request dedupe | `services/shared/utils/requestDedupe.js` | Routes with dedupe scopes return `202` on duplicate idempotent requests. No Idempotency header means the request runs normally. |
| Job state | `services/shared/utils/jobStore.js`, `stateFile.js` | Async jobs are stored in shared state. Production requires durable R2 metasystem state unless explicitly allowing ephemeral state. |
| Temporary files | `scripts/tempStorage.js`, TTS processors | Defaults to `/tmp/ai-management-suite`; audio processors use subdirectories beneath `APP_TMP_DIR` unless overridden. |

## Service inventory

| Service | Path | Status | Purpose | Mounted route(s) | Key files | Main dependencies | Storage | Tests |
|---|---|---|---|---|---|---|---|---|
| audits | `audits/` | Implemented | GitHub-dispatched Mobile UX and SEO/AEO/GEO audits plus local on-brand audit reporting. | `/audits/*` | audits/routes/*.js, audits/utils/*.js | OpenRouter, GitHub Actions, Cloudflare R2 | R2 audits bucket, durable job state | audit-*.test.js, mobile-ux-audit-service.test.js, on-brand-audit.test.js |
| artwork | `services/artwork/` | Implemented | OpenRouter image generation for podcast, blog and direct artwork requests. | `/artwork/create, /artwork/generate` | routes/generateArtwork.js, createBlogArtwork.js, createPodcastArtwork.js | OpenRouter, R2 | art, blogImages buckets | Indirect via blog/podcast tests |
| blog | `services/blog/` | Implemented | Weekly AI briefing posts, social/daily posts, blog RSS publishing and rebuild hooks. | `/blog/weekly/build, /blog/rss/rebuild, /blog/social/*` | weekly/buildWeeklyBlogPost.js, social/buildDailySocialBlogPost.js, rss/publishBlogRssFeed.js | OpenRouter, R2, website rebuild webhook | blog, blogImages, blogRss buckets | blog-*.test.js |
| cloudflare-purge | `services/cloudflare-purge/` | Implemented | Cloudflare zone cache purge API wrapper with optional shared-secret header. | `/cloudflare/health, /cloudflare/purge` | routes/index.js, utils/purgeCloudflareCache.js | Cloudflare API | None | Covered by route/runtime tests only if added later |
| comms-hub | `services/comms-hub/` | Implemented first production slice | Verifies the three registered Jotform submissions, persists contacts/conversations/messages to D1 and archives redacted integrity receipts through a leased R2 queue. | `/comms-hub/*` | routes/index.js, intakeService.js, repositories/commsRepository.js, workers/archiveWorker.js | Jotform API, Cloudflare D1, shared R2 client | D1 plus `comms-hub` R2 receipts | comms-hub-*.test.js |
| oneup | `services/oneup/` | Implemented | Daily lane, weekly quiz, weekly ebook and published-history workflows for OneUp. | `/oneup/*` | routes/social.js, utils/socialScheduler.js, utils/oneupClient.js | OneUp API, OpenRouter, RSS context, local ebook catalogue | Durable scheduler state through shared state utilities | oneup-social.test.js |
| outreach | `services/outreach/` | Implemented | SERP discovery, domain filtering, enrichment, email validation, scoring and Google Sheets append. | `/outreach/*` | routes/index.js, services/outreachCore.js, services/serp-OutreachService.js, services/batchService.js | SERP API, Hunter, Prospeo, Apollo, ZeroBounce, urlscan, OpenPageRank, Google Sheets | R2 metasystem for batch cursor | No dedicated route test found |
| podcast | `services/podcast/` | Implemented | End-to-end podcast pipeline wrapper: script, artwork, TTS, podcast RSS, cleanup and rebuild hook. | `/podcast/run, /podcast/status/:sessionId, /podcast/health` | index.js, runPodcastPipeline.js | Script, Artwork, TTS, Podcast RSS, R2 | Job store plus podcast/audio/meta buckets | podcast-*.test.js |
| rss-feed-creator | `services/rss-feed-creator/` | Implemented | Fetches configured RSS/URL sources, rewrites items with AI, emits newsletter RSS and JSON. | `/rss, /rss/rewrite` | rewrite-pipeline.js, utils/fetchFeeds.js, utils/models.js, utils/feedGenerator.js | OpenRouter, R2, rss-parser | rss bucket: feed.xml, feed.json, rotation data | rss-feed-creator-brand.test.js, feed-fetching.test.js |
| rss-feed-podcast | `services/rss-feed-podcast/` | Implemented as callable module | Builds podcast RSS from episode metadata and optionally notifies PodcastIndex. | `Called by podcast pipeline; not mounted directly` | index.js, generateFeed.js, xmlBuilder.js | R2, PodcastIndex | podcastRss bucket, meta bucket | podcast-rss-contract.test.js |
| rss-links | `services/rss-links/` | Implemented | Self-hosted RSS short-link creation and redirect storage. | `/rss-links/shorten, /rss-links/:key` | service.js, store.js, routes/*.js | R2 | rss bucket under rss-links/ | No dedicated test found |
| script | `services/script/` | Implemented | Podcast script generation, composition, editorial pass, chunking, transcript and metadata upload. | `/script/*` | routes/index.js, utils/orchestrator.js, utils/promptTemplates.js, utils/editAndFormat.js | OpenRouter, Weather/RapidAPI, R2 | rawtext, transcript, meta, metasystem buckets | scriptValidation.test.js, transcript-html-template.test.js, getSponsor.test.js |
| shared | `services/shared/` | Implemented | Common HTTP, OpenRouter, R2, durable state, job store, dedupe, rate limit and schemas. | `Used by all services` | utils/ai-service.js, utils/r2-client.js, utils/stateFile.js, middleware/rateLimit.js | OpenRouter, R2 | metasystem durable state | durable-state.test.js, openrouter-service-routing.test.js |
| tts | `services/tts/` | Implemented | TTS orchestration with Polly, R2 chunk output, FFmpeg merge/edit and final podcast mastering. | `/tts/orchestrate, /tts/status/:sessionId, /tts/health` | routes/tts.js, utils/ttsProcessor.js, utils/mergeProcessor.js, utils/editingProcessor.js, utils/podcastProcessor.js | AWS Polly, FFmpeg, R2 | chunks, merged, edited, podcast, meta buckets | merge-processor.test.js |
| api | `services/api/` | Present but not wired | Aggregator router for podcast/script/tts/artwork exists but is not mounted in routes/index.js. | None active | services/api/index.js | Express | None | No dedicated test found |

## Active route map

The table below is built from the active mounted routers in `routes/index.js` and the route files they import.

| Method | Full path | Service | Purpose | Request fields | Authentication / guard | Response behaviour |
|---|---|---|---|---|---|---|
| `GET` | `/` | core | Liveness smoke response. | None | None | Text `OK`. |
| `GET` | `/health` | core | Runtime health response including trust-proxy value. | None | None | JSON `{ ok, status, trustProxy }`. |
| `GET` | `/rss` | rss-feed-creator | Returns newsletter RSS XML from R2. | None | None | `application/rss+xml`; returns fallback empty feed if object is empty. |
| `POST` | `/rss` | rss-feed-creator | Runs end-to-end RSS rewrite pipeline. | No fixed body. | Idempotency header only affects dedupe on /rss/rewrite, not this route. | JSON with `ok`, `route`, `message`, `result`. |
| `POST` | `/rss/rewrite` | rss-feed-creator | Runs end-to-end RSS rewrite pipeline via mounted rewrite router. | No required fields. | Request dedupe scope `rss:rewrite`. | JSON with `totalItems`, `rewrittenItems`, `message`. |
| `GET` | `/script/health` | script | Script service health. | None | None | JSON `{ ok: true, service: "script" }`. |
| `POST` | `/script/intro` | script | Generate intro text. | Optional `sessionId`, `date`, `prompt`. | Request dedupe `script:intro`. | JSON `{ ok, sessionId, text }`. |
| `POST` | `/script/main` | script | Generate main segment text. | Optional `sessionId`, `rssUrl`, `maxItems`, `prompt`. | Request dedupe `script:main`. | JSON `{ ok, sessionId, text }`. |
| `POST` | `/script/outro` | script | Generate outro text. | Optional `sessionId`, `prompt`. | Request dedupe `script:outro`. | JSON `{ ok, sessionId, text }`. |
| `POST` | `/script/compose` | script | Compose intro/main/outro into a full episode package. | Optional `sessionId`, `intro`, `main[]`, `outro`, `editorPrompt`. | Request dedupe `script:compose`. | JSON `{ ok, sessionId, ...result }`. |
| `POST` | `/script/orchestrate` | script | Generate full script, upload chunks, transcript and metadata. | Optional `sessionId`, `date`, `tone`, `location`. | Request dedupe `script:orchestrate`. | JSON includes `fullText`, `chunks`, `metadata` when successful. |
| `GET` | `/tts/health` | tts | TTS service health. | None | None | JSON `{ ok, service }`. |
| `GET` | `/tts/status/:sessionId` | tts | Reads async TTS job status. | Path `sessionId`. | None | 200 with public job, 404 if not found. |
| `POST` | `/tts/orchestrate` | tts | Starts asynchronous TTS job for an existing script session. | Optional `sessionId`; passthrough accepted. | Request dedupe `tts:orchestrate`. | 202 with `statusUrl`; duplicate active job also returns 202. |
| `POST` | `/artwork/create` | artwork | Stores artwork request JSON for later handling. | Any JSON object. | Request dedupe `artwork:create`. | JSON with R2 bucket alias and key. |
| `POST` | `/artwork/generate` | artwork | Generates PNG artwork and stores it in R2. | Optional `sessionId`, `prompt`. | Request dedupe `artwork:generate`. | JSON `{ ok, sessionId, url }`. |
| `GET` | `/podcast/health` | podcast | Podcast service health. | None | None | JSON `{ ok, service, time }`. |
| `POST` | `/podcast/run` | podcast | Starts asynchronous full podcast pipeline. | Optional `sessionId` or `data.sessionId`; passthrough accepted. | Request dedupe `podcast:run`. | 202 with `statusUrl`; duplicate active job returns existing job. |
| `GET` | `/podcast/status/:sessionId` | podcast | Reads async podcast pipeline job status. | Path `sessionId`. | None | 200 with public job, 404 if not found. |
| `GET` | `/outreach/health` | outreach | Outreach service health. | None | None | JSON `{ ok, service }`. |
| `POST` | `/outreach/keyword` | outreach | Runs one outreach keyword scan and appends accepted leads. | Required `keyword` string. | Request dedupe `outreach:keyword`. | JSON with saved-lead and domain counts. |
| `POST` | `/outreach/batch/next` | outreach | Runs the next configured keyword batch. | No required body. | Request dedupe `outreach:batchNext`. | JSON with `processed`, `done`, `lastProcessedIndex`. |
| `POST` | `/outreach/batch/reset` | outreach | Resets batch cursor. | Optional `lastProcessedIndex` integer. | Request dedupe `outreach:batchReset`. | JSON with new cursor. |
| `POST` | `/blog/weekly/build` | blog | Builds and publishes a weekly blog post. | Optional `days` 1-31 or `weekId` `YYYY-WNN`. | Request dedupe `blog:weeklyBuild`. | JSON build result including post, RSS and rebuild metadata. |
| `POST` | `/blog/rss/rebuild` | blog | Rebuilds weekly blog RSS from manifest. | No required body. | None | JSON RSS publishing result. |
| `POST` | `/blog/social/daily/build` | blog | Builds daily/social blog post. | Optional `date`, `days` 1-7, `dryRun`, `force`. | Request dedupe `blog:socialDailyBuild`. | JSON build result or skip/dry-run result. |
| `POST` | `/blog/social/rss/rebuild` | blog | Rebuilds daily/social blog RSS from manifest. | No required body. | None | JSON RSS publishing result. |
| `GET` | `/cloudflare/health` | cloudflare-purge | Cloudflare purge service health/config check. | None | None | JSON with `configured` flag. |
| `POST` | `/cloudflare/purge` | cloudflare-purge | Purges Cloudflare cache for one selected mode. | Exactly one of `purge_everything`, `files[]`, `tags[]`, `hosts[]`, `prefixes[]`. | Optional `x-cloudflare-purge-secret` required only when env secret is set. | JSON with Cloudflare purge result. |
| `GET` | `/oneup/health` | oneup | OneUp service health and available lanes. | None | None | JSON with lane keys and route hints. |
| `POST` | `/oneup/posts/history` | oneup | Fetches published post history from OneUp. | Optional `start`, `maxPages`, `lookbackDays`, `apiKey`. | Request dedupe `oneup:posts:history`. | JSON with OneUp rows and pagination metadata. |
| `POST` | `/oneup/daily/:laneKey` | oneup | Builds and schedules a daily lane post. Lane keys: monday-sunday. | Optional `publishDate`, `scheduledDateTime`, `dryRun`, `categoryName`, `socialNetworkId`, `imageUrl`, `apiKey`. | Request dedupe `oneup:<laneKey>`. | JSON with generated post and scheduling status. |
| `POST` | `/oneup/ebooks/weekly` | oneup | Builds/schedules Tuesday, Thursday and Saturday ebook posts. | Optional `weekStartDate`, `featuredBook`, `usePodcastFeaturedBook`, `publishTimes`, `scheduledDateTimes`, `dryRun`, category/network/image/api fields. | Request dedupe `oneup:ebooks:weekly`. | JSON with featured book, per-day posts, warnings. |
| `POST` | `/oneup/quiz/weekly` | oneup | Builds/schedules weekly quiz question and answer posts. | Optional question/answer dates or scheduled datetimes, `dryRun`, category/network/image/api fields. | Request dedupe `oneup:quiz:weekly`. | JSON with question/answer scheduling results. |
| `GET` | `/audits/mobile-ux/health` | audits | Mobile UX audit health. | None | None | JSON health. |
| `POST` | `/audits/mobile-ux/run` | audits | Dispatches website Mobile UX audit workflow. | Optional `sessionId`, `websiteUrl`, `reportPrefix`, `workflowRef`, `requestedBy`, `notes`, `excludePatterns`. | Request dedupe; GitHub token required in env. | 202 with queued job and dispatch metadata. |
| `POST` | `/audits/mobile-ux/callback` | audits | Receives Mobile UX audit workflow callback. | Audit callback schema: `auditType`, `sessionId`, `status`, `reportPrefix`, artefact URLs. | Bearer token or `x-audit-callback-token`. | JSON completion result. |
| `GET` | `/audits/mobile-ux/jobs/:sessionId` | audits | Reads Mobile UX audit job state. | Path `sessionId`. | None | 200 public job or 404. |
| `GET` | `/audits/seo-aeo-geo/health` | audits | SEO/AEO/GEO audit health. | None | None | JSON health. |
| `POST` | `/audits/seo-aeo-geo/run` | audits | Dispatches website SEO/AEO/GEO forensic audit workflow. | Same audit-run schema as Mobile UX. | Request dedupe; GitHub token required in env. | 202 with queued job and dispatch metadata. |
| `POST` | `/audits/seo-aeo-geo/analysis` | audits | Starts AI analysis for audit payload submitted by workflow. | Requires `sessionId`, `baseUrl`, `inventory`, `priorityPages[]`, `allRoutes[]`, `repoSignals`. | Bearer token or `x-audit-callback-token`. | 200 if completed quickly, otherwise 202 with analysis status URL. |
| `GET` | `/audits/seo-aeo-geo/analysis/:sessionId` | audits | Reads SEO/AEO/GEO AI analysis job. | Path `sessionId`. | Bearer token or `x-audit-callback-token`. | 202 running/queued, 200 completed, 409 failed/incomplete. |
| `POST` | `/audits/seo-aeo-geo/callback` | audits | Receives SEO/AEO/GEO workflow callback. | Audit callback schema. | Bearer token or `x-audit-callback-token`. | JSON completion result. |
| `GET` | `/audits/seo-aeo-geo/jobs/:sessionId` | audits | Reads SEO/AEO/GEO audit job state. | Path `sessionId`. | None | 200 public job or 404. |
| `GET` | `/audits/on-brand/health` | audits | On-brand audit health. | None | None | JSON health. |
| `POST` | `/audits/on-brand/run` | audits | Runs local on-brand audit over OneUp, podcast transcript and RSS evidence. | Optional `sessionId`, `lookbackDays`, `includeOneUp`, `includePodcastTranscripts`, `includeRss`, `dryRun`. | Request dedupe `audits:on-brand:run`. | JSON audit report result and published artefacts unless dry-run. |
| `POST` | `/rss-links/shorten` | rss-links | Creates or reuses an RSS short link. | Required `url` absolute http/https URL. | None | 201 if new, 200 if reused. |
| `GET` | `/rss-links/:key` | rss-links | Redirects a short key to original URL. | Path `key` 4-32 alphanumeric. | None | 302 redirect; query string preserved. |
| `GET` | `/rss-links/:key/index.html` | rss-links | Redirect page URL variant. | Path `key` 4-32 alphanumeric. | None | 302 redirect; query string preserved. |
| `GET` | `/comms-hub/health` | comms-hub | Reports sanitised Comms Hub configuration and runtime readiness. | None | Public health path. | 200 when ready or disabled; 503 when enabled but not ready. |
| `POST` | `/comms-hub/intake/jotform` | comms-hub | Accepts a Jotform webhook, re-fetches the submission through Jotform API, verifies form/submission identity and persists the event atomically. | `formID`, `submissionID`; JSON, URL-encoded or multipart identifiers. | Exact public path only; Jotform API re-verification; global rate limit; 1 MB service limit. | 202 accepted, 200 duplicate, 4xx rejected, 5xx provider/storage failure. |
| `GET` | `/comms-hub/diagnostics` | comms-hub | Returns migration and archive-queue status. | None | AIMS bearer token. | 200 when schema is ready, otherwise 503. |
| `GET` | `/comms-hub/conversations/:conversationId` | comms-hub | Reads one persisted conversation with contact, messages and attachment references. | Path `conversationId`. | AIMS bearer token. | 200, 400 or 404. |
| `GET` | `/comms-hub/archive/status` | comms-hub | Returns archive queue counts by state. | None | AIMS bearer token. | 200 JSON. |
| `POST` | `/comms-hub/archive/drain` | comms-hub | Runs one bounded archive drain using distributed D1 leases. | Optional `limit`. | AIMS bearer token. | 200 with processed/completed/failed counts. |

## Present but not wired or legacy route files

These files exist but are not mounted by the active root route registry:

| Path | Evidence | Status |
|---|---|---|
| `services/api/index.js` | Exports an aggregator router for podcast/script/tts/artwork. `routes/index.js` does not mount it. | Present but not wired. |
| `routes/podcast.js` | Root-level route file exists separately from `services/podcast/index.js`. | Legacy/unmounted. |
| `routes/podcast-pipeline.js` | Contains internal route-calling pipeline logic, but is not mounted. | Legacy/unmounted. |
| `routes/rewrite.js` | Root-level rewrite route file exists, but active rewrite route is under `services/rss-feed-creator/routes/rewrite.js`. | Legacy/unmounted. |
| `routes/script.js` and `routes/script-orchestrate.js` | Root-level script route files exist, but active script routes are under `services/script/routes/index.js`. | Legacy/unmounted. |
| `services/rss-feed-creator/routes/index.js` | Defines `GET /` for that local router. It is not mounted by `routes/index.js`. | Present but not wired. |
| `services/rss-feed-creator/routes/run-rss-route.js` | Exports an app-level `/run-rss` helper, not mounted by current server bootstrap. | Present but not wired. |
| `services/tts/routes/info.js`, `merge.js`, `podcast.js`, `orchestrateTTS.js` | Route files exist; current active TTS router is `services/tts/routes/tts.js`. | Present but not wired. |

## Environment variables

### How to read this section

- **Core** means the variable affects app startup or server behaviour.
- **Conditional** means the variable is required only when the matching service route/workflow is used.
- **Optional/legacy** means the code has a default, fallback, compatibility path, or the variable appears to be ahead of current implementation.
- Secret-looking values are documented by name and purpose only. Do not commit real values.
- Koyeb should hold runtime secrets and service configuration. GitHub Actions should hold CI/workflow secrets such as website rebuild hooks and audit workflow tokens where those workflows use them.

### Core app

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `NODE_ENV` | Runtime mode; production enables production logging and durable-state enforcement. | server.js, scripts/*, shared utilities | Core | `production` | Set only for services you run. |
| `PORT` | HTTP listener port. | server.js, scripts/*, shared utilities | Core | `3000` | Set only for services you run. |
| `LOG_LEVEL` | Pino log level. | server.js, scripts/*, shared utilities | Optional/conditional | `info` | Set only for services you run. |
| `NODE_OPTIONS` | Node runtime memory/options hint for hosted deployments. | server.js, scripts/*, shared utilities | Optional/conditional | `--max-old-space-size=1536` | Set only for services you run. |
| `APP_TITLE` | Application title used in AI/OpenRouter headers and metadata. | server.js, scripts/*, shared utilities | Optional/conditional | `AI Management Suite` | Set only for services you run. |
| `APP_URL` | Public base URL for callbacks and defaults. | server.js, scripts/*, shared utilities | Core | `https://example.com` | Set only for services you run. |
| `CORS_ORIGINS` | Comma-separated browser origins allowed by CORS. | server.js, scripts/*, shared utilities | Optional/conditional | `blank` | Set only for services you run. |
| `DEBUG_ROUTES` | Enables route-level debug logging. | server.js, scripts/*, shared utilities | Optional/conditional | `false` | Set only for services you run. |
| `SHUTDOWN_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `10000` | Set only for services you run. |
| `BOOTSTRAP_STEP_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `120000` | Set only for services you run. |
| `AUTO_CALL` | Core app setting. | server.js, scripts/*, shared utilities | Optional/conditional | `yes` | Set only for services you run. |
| `INTERNAL_BASE_HOST` | Core app setting. | server.js, scripts/*, shared utilities | Optional/conditional | `127.0.0.1` | Set only for services you run. |
| `INTERNAL_BASE_PROTO` | Core app setting. | server.js, scripts/*, shared utilities | Optional/conditional | `http` | Set only for services you run. |
| `TRUST_PROXY` | Core app setting. | server.js, scripts/*, shared utilities | Optional/conditional | `1` | Set only for services you run. |
| `JSON_BODY_LIMIT` | Core app setting. | server.js, scripts/*, shared utilities | Optional/conditional | `10mb` | Set only for services you run. |
| `URLENCODED_BODY_LIMIT` | Core app setting. | server.js, scripts/*, shared utilities | Optional/conditional | `10mb` | Set only for services you run. |
| `APP_TMP_DIR` | Temporary working directory for FFmpeg/audio and bootstrap checks. | server.js, scripts/*, shared utilities | Optional/conditional | `/tmp/ai-management-suite` | Set only for services you run. |
| `APP_STATE_DIR` | Durable/local state backend and paths. | server.js, scripts/*, shared utilities | Optional/conditional | `/tmp/ai-management-suite/state` | Set only for services you run. |
| `JOB_STATUS_TTL_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `86400000` | Set only for services you run. |
| `REQUEST_DEDUPE_TTL_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `21600000` | Set only for services you run. |
| `RATE_LIMIT_ENABLED` | Global in-memory HTTP rate limiting control. | server.js, scripts/*, shared utilities | Optional/conditional | `true` | Set only for services you run. |
| `RATE_LIMIT_WINDOW_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `60000` | Set only for services you run. |
| `RATE_LIMIT_MAX_REQUESTS` | Global in-memory HTTP rate limiting control. | server.js, scripts/*, shared utilities | Optional/conditional | `60` | Set only for services you run. |
| `STATE_BACKEND` | Durable/local state backend and paths. | server.js, scripts/*, shared utilities | Optional/conditional | `auto` | Set only for services you run. |
| `STATE_REMOTE_PREFIX` | Durable/local state backend and paths. | server.js, scripts/*, shared utilities | Optional/conditional | `state` | Set only for services you run. |
| `INTERNAL_ROUTE_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `60000` | Set only for services you run. |
| `WEBHOOK_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `15000` | Set only for services you run. |
| `FEED_FETCH_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `15000` | Set only for services you run. |
| `PODCAST_FETCH_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `30000` | Set only for services you run. |
| `ARTWORK_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `60000` | Set only for services you run. |
| `CLOUDFLARE_PURGE_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | services/cloudflare-purge | Optional/conditional | `15000` | Set only for services you run. |
| `RSS_OBJECT_KEY` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `feed.xml` | Secret value; keep in Koyeb/GitHub secret storage. |
| `ALLOW_EPHEMERAL_STATE` | Durable/local state backend and paths. | server.js, scripts/*, shared utilities | Optional/conditional | `false` | Set only for services you run. |

### AIMS Comms Hub

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `COMMS_HUB_ENABLED` | Enables service runtime and readiness enforcement. | services/comms-hub, server.js | Required switch | `false` | Keep false until both migrations succeed. |
| `D1_UUID` | Cloudflare D1 database UUID and migration target. | Comms Hub migration and D1 client | Required when enabled | `blank` | Koyeb secret-backed administrative value. |
| `D1_API_KEY` | Cloudflare token used by explicit migrations and Phase 1 REST fallback. | scripts/commsHubMigrate.js, D1 client | Required when enabled | `blank` | Runtime social queries use the Worker proxy instead. |
| `COMMS_HUB_D1_PROXY_URL` | Bound-Worker runtime query endpoint. | Phase 2 D1 client | Required when either social family is enabled | `blank` | Use the exact `/query` URL. |
| `COMMS_HUB_D1_PROXY_TOKEN` | Bearer secret shared with the D1 Worker. | Phase 2 D1 client and Worker | Required when either social family is enabled | `blank` | Independent of Cloudflare API tokens. |
| `COMMS_HUB_PUBLIC_BASE_URL` | Public AIMS origin used to register Zernio webhooks. | socialService.js | Required when either social family is enabled | `blank` | No trailing slash required. |
| `JOTFORM_API_KEY` | Re-fetches and verifies webhook submissions. | jotformClient.js | Required when enabled | `blank` | Koyeb secret-backed value. |
| `ZERNIO_META_API_KEY` | Facebook/Instagram inbox credential. | zernioInboxClient.js | Required when Meta is enabled | `blank` | Never falls back to the Video or legacy key. |
| `ZERNIO_VIDEO_API_KEY` | YouTube comment credential. | zernioInboxClient.js | Required when Video is enabled | `blank` | Never falls back to the Meta or legacy key. |
| `ZERNIO_META_WEBHOOK_SECRET` | HMAC secret for the Meta webhook endpoint. | domain/zernioWebhook.js | Required when Meta is enabled | `blank` | Separate from the Meta API key. |
| `ZERNIO_VIDEO_WEBHOOK_SECRET` | HMAC secret for the Video webhook endpoint. | domain/zernioWebhook.js | Required when Video is enabled | `blank` | Separate from the Video API key. |
| `COMMS_HUB_ZERNIO_META_ENABLED` | Enables Facebook/Instagram ingestion, actions and polling. | Comms Hub runtime | Optional switch | `false` | Can be enabled independently. |
| `COMMS_HUB_ZERNIO_VIDEO_ENABLED` | Enables YouTube comment ingestion, actions and polling. | Comms Hub runtime | Optional switch | `false` | Can be enabled independently. |
| `R2_BUCKET_COMMS_HUB` | Private R2 bucket for redacted integrity receipts and operational objects. | shared R2 client, archive worker | Required when enabled | `comms-hub` | Access is authenticated; message content and attachments remain segregated. |
| `R2_PUBLIC_BASE_URL_COMMS_HUB` | Legacy public receipt base. | compatibility only | Not required | `blank` | Keep blank; disable the bucket public development URL/custom public domain in Cloudflare. |
| `COMMS_HUB_MAX_WEBHOOK_BYTES` | Service-specific webhook size cap. | webhook domains, server.js | Optional | `1048576` | Enforced before JSON parsing on exact intake routes. |
| `COMMS_HUB_ZERNIO_ACK_TIMEOUT_MS` | Maximum synchronous webhook acceptance budget. | socialService.js | Optional | `4000` | Hard-capped at 4500 ms so Zernio can retry rather than wait beyond its acknowledgement window. |
| `COMMS_HUB_ZERNIO_POLL_ENABLED` | Enables leased fallback polling. | socialPollWorker.js | Optional | `true` | Poll jobs are isolated by credential family and platform. |
| `COMMS_HUB_ARCHIVE_WORKER_ENABLED` | Enables the leased receipt worker. | runtime.js, archiveWorker.js | Optional | `true` | D1 remains the authoritative private store. |
| `ONECOM_INFO_PASSWORD`, `ONECOM_NEWSLETTER_PASSWORD`, `ONECOM_ADMIN_PASSWORD` | one.com mailbox secrets. `ONECOM_INFO_PASSWORD` is used by the live Comms Hub customer inbox; admin/newsletter remain isolated for service administration and Brevo/newsletter use. | Comms Hub email + future newsletter/admin integrations | Conditional | `blank` | Keep all passwords in Koyeb secrets; only info@ is polled by Comms Hub. |

### Cloudflare purge

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `CF_zone` / `CLOUDFLARE_ZONE_ID` | Cloudflare zone ID for cache purge. | services/cloudflare-purge | Required for purge calls | `blank` | Prefer `CF_zone={{secret.CF_ZONE}}` in Koyeb. |
| `CF_purge` / `CLOUDFLARE_PURGE_API_TOKEN` | Cloudflare API token used as outbound bearer auth. | services/cloudflare-purge | Required for token auth | `blank` | Prefer `CF_purge={{secret.CF_PURGE}}`; the code also strips an accidental leading `Bearer `. |
| `CLOUDFLARE_PURGE_SHARED_SECRET` | Legacy inbound route secret. | services/cloudflare-purge | Optional | `blank` | `/cloudflare/purge` now accepts suite bearer, this secret, or no inbound auth. |
| `CF_EMAIL` + `CF_GLOBAL_API_KEY` | Legacy Cloudflare global-key fallback. | services/cloudflare-purge | Optional fallback | `blank` | Only used if no API token env is configured. |

### Cloudflare R2

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `R2_ENDPOINT` | Cloudflare R2 setting. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Set only for services you run. |
| `R2_REGION` | Cloudflare R2 setting. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `auto` | Set only for services you run. |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 setting. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 setting. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `R2_BUCKET_PODCAST` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_RAW` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_RAW_TEXT` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_META` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_META_SYSTEM` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_MERGED` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_ART` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_RSS_FEEDS` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_PODCAST_RSS_FEEDS` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_TRANSCRIPTS` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_CHUNKS` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_EDITED_AUDIO` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_BLOG` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_BLOG_IMAGES` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_BLOG_RSS` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | Bucket name, not URL. |
| `R2_BUCKET_AUDITS` | Cloudflare R2 bucket name for the matching storage alias. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `audits` | Bucket name, not URL. |
| `R2_PUBLIC_BASE_URL_PODCAST` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_RAW_TEXT` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_META` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_META_SYSTEM` | Legacy public base for durable system state. | compatibility only | Not required | `blank` | Keep blank; `metasystem` is authenticated/private and must not be anonymously exposed. |
| `R2_PUBLIC_BASE_URL_MERGE` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_ART` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_RSS` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_PODCAST_RSS` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_TRANSCRIPT` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_CHUNKS` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_EDITED_AUDIO` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_BLOG` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_BLOG_IMAGES` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_BLOG_RSS` | Public base URL used to build externally reachable object URLs. | services/shared/utils/r2-client.js and storage-backed services | Conditional; required by storage-backed services | `blank` | No trailing slash preferred. |
| `R2_PUBLIC_BASE_URL_AUDITS` | Legacy public-base variable for the private audits bucket. | services/shared/utils/r2-client.js and audit services | Leave blank | `` | Audit artefacts use authenticated R2 access and `r2://audits/...` references. |

### OpenRouter / AI routing

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `OPENROUTER_API_BASE` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `https://openrouter.ai/api/v1` | Set only for services you run. |
| `OPENROUTER_BASE_URL` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `https://openrouter.ai/api/v1` | Set only for services you run. |
| `OPENROUTER_API_KEY` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `OPENROUTER_SITE_URL` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `https://app.jonathan-harris.online` | Set only for services you run. |
| `OPENROUTER_APP_NAME` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `AI Management Suite` | Set only for services you run. |
| `OPENROUTER_SORT_BY` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `price` | Set only for services you run. |
| `OPENROUTER_SERVICE_TIER` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `auto` | Set only for services you run. |
| `OPENROUTER_ENABLE_FALLBACKS` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `true` | Set only for services you run. |
| `OPENROUTER_REQUIRE_PARAMETERS_FOR_JSON` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `true` | Set only for services you run. |
| `AI_USAGE_LOG_ENABLED` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `true` | Set only for services you run. |
| `HEADROOM_ENABLED` | Enables pre-OpenRouter context compression for selected text routes. | services/shared/utils/headroom.js | No | `false` | Requires a reachable Headroom `/v1/compress` service before enabling. |
| `HEADROOM_BASE_URL` | Base URL of the Headroom proxy/compression service. | services/shared/utils/headroom.js | Required when Headroom is enabled | `blank` | May end at the host root or `/v1`; artwork traffic does not use it. |
| `HEADROOM_API_KEY` / `HEADROOM_PROXY_TOKEN` | Optional bearer authentication for the Headroom service. | services/shared/utils/headroom.js | Conditional | `blank` | Keep secret values in Koyeb/GitHub secret storage. |
| `HEADROOM_TIMEOUT_MS` | Maximum wait for compression before AIMS fails open to the original messages. | services/shared/utils/headroom.js | No | `5000` | External caller aborts are propagated instead of failing open. |
| `HEADROOM_MIN_INPUT_CHARS` | Minimum text payload size before compression is attempted. | services/shared/utils/headroom.js | No | `2000` | Avoids spending compression overhead on small prompts. |
| `HEADROOM_TARGET_RATIO` | Requested compression ratio for eligible calls. | services/shared/utils/headroom.js | No | `0.7` | Compression is rejected if it does not actually save tokens. |
| `HEADROOM_ROUTES` | Comma-separated allowlist of AIMS route keys eligible for compression. | services/shared/utils/headroom.js | No | curated batch routes | Multimodal visual-QA/image routes are hard-bypassed. |
| `AI_MODEL_FAST` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `google/gemini-2.5-flash-lite` | Set only for services you run. |
| `AI_MODEL_STANDARD` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `openai/gpt-5.6-luna` | Set only for services you run. |
| `AI_MODEL_HIGH_QUALITY` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `anthropic/claude-sonnet-4.6` | Set only for services you run. |
| `AI_MODEL_FALLBACK` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `openai/gpt-5.6-sol` | Set only for services you run. |
| `AI_MODEL_JSON` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `openai/gpt-5.6-luna` | Set only for services you run. |
| `AI_MODEL_SUMMARY` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `google/gemini-2.5-flash-lite` | Set only for services you run. |
| `AI_MODEL_AUDIT` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `anthropic/claude-sonnet-4.6` | Set only for services you run. |
| `AI_MODEL_IMAGE` | OpenRouter image-model configuration. | services/shared/utils/ai-config.js, artwork.js | Conditional; required by image generation routes | `bytedance-seed/seedream-4.5` | Image traffic remains direct to OpenRouter and is never routed through Headroom. |
| `OPENROUTER_ART` | Primary OpenRouter artwork model. | services/artwork/utils/artwork.js | Conditional; required by artwork generation | `bytedance-seed/seedream-4.5` | Kept separate from Headroom chat compression. |
| `OPENROUTER_ART_BACKUP` | Backup OpenRouter artwork model. | services/artwork/utils/artwork.js | Conditional; required by artwork failover | `black-forest-labs/flux.2-pro` | Kept separate from Headroom chat compression. |
| `OPENROUTER_ANTHROPIC_4_6` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `anthropic/claude-sonnet-4.6` | Set only for services you run. |
| `OPENROUTER_META` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `meta-llama/llama-4-scout` | Set only for services you run. |
| `AI_MAX_RETRIES` | Global retry budget per configured text provider. | services/shared/utils/ai-service.js | No | `4` | Enforced as a minimum of four retries; route-level overrides may intentionally use fewer. |
| `AI_MAX_TOKENS` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `4096` | Secret value; keep in Koyeb/GitHub secret storage. |
| `AI_RETRY_BASE_MS` | Timeout, delay or TTL control in milliseconds. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `750` | Set only for services you run. |
| `AI_TEMPERATURE` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `0.65` | Set only for services you run. |
| `AI_TIMEOUT` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `90000` | Set only for services you run. |
| `AI_TOP_P` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by AI generation routes | `0.9` | Set only for services you run. |
| `BLOG_ARTWORK_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | services/blog, services/artwork | Conditional; required by AI generation routes | `120000` | Set only for services you run. |
| `BLOG_FALLBACK_IMAGE_URL` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Conditional; required by AI generation routes | `blank` | Set only for services you run. |

### Podcast / RSS metadata

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `PODCAST_TITLE` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `Turing’s Torch: Artificial Intelligence Weekly` | Set only for services you run. |
| `PODCAST_AUTHOR` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `Jonathan Harris` | Set only for services you run. |
| `PODCAST_DESCRIPTION` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `A sceptical, plain-English weekly artificial intelligence podcast hosted by J...` | Set only for services you run. |
| `PODCAST_LINK` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `https://jonathan-harris.online/podcast/` | Set only for services you run. |
| `PODCAST_LANGUAGE` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `en-gb` | Set only for services you run. |
| `PODCAST_EXPLICIT` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `no` | Set only for services you run. |
| `PODCAST_CATEGORY_1` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_CATEGORY_2` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_COPYRIGHT` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_IMAGE_URL` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_OWNER_NAME` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `Jonathan Harris` | Set only for services you run. |
| `PODCAST_OWNER_EMAIL` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCASTINDEX_USER_AGENT` | PodcastIndex hub notification configuration. | server.js, scripts/*, shared utilities | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_INTRO_URL` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Conditional; required by TTS/podcast audio routes | `blank` | Set only for services you run. |
| `PODCAST_OUTRO_URL` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Conditional; required by TTS/podcast audio routes | `blank` | Set only for services you run. |
| `PODCAST_RSS_EP` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `Yes` | Set only for services you run. |
| `PODCAST_RSS_FEED_URL` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_GUID` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_LOCKED` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `yes` | Set only for services you run. |
| `PODCAST_TARGET_MINUTES` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_LOCKED_OWNER_EMAIL` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_GENERATOR` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_FFMPEG_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `900000` | Set only for services you run. |
| `PODCAST_MERGE_TMP_DIR` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_EDIT_TMP_DIR` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_MASTER_TMP_DIR` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `MERGE_BATCH_SIZE` | Podcast / RSS metadata setting. | server.js, scripts/*, shared utilities | Optional/conditional | `2` | Set only for services you run. |
| `MERGE_CLEANUP_DELAY_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `120000` | Set only for services you run. |
| `MERGE_DOWNLOAD_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | server.js, scripts/*, shared utilities | Optional/conditional | `30000` | Set only for services you run. |
| `PODCAST_ITUNES_TYPE` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `episodic` | Set only for services you run. |
| `PODCAST_ITUNES_KEYWORDS` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `PODCAST_FUNDING_URL` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `PODCAST_FUNDING_TEXT` | Podcast feed, audio, transcript or processing metadata/configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Set only for services you run. |
| `API_KEY_PODCAST_INDEX` | PodcastIndex hub notification configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `API_SECRET_PODCAST_INDEX` | PodcastIndex hub notification configuration. | services/podcast, services/rss-feed-podcast, services/tts | Optional/conditional | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `RSS_FEED_TITLE` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `blank` | Set only for services you run. |
| `RSS_FEED_DESCRIPTION` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `blank` | Set only for services you run. |
| `FEED_URL` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `blank` | Set only for services you run. |
| `FEED_CUTOFF_HOURS` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `48` | Set only for services you run. |
| `FEED_RETENTION_DAYS` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `60` | Retain enough rewritten history for weekly blog recovery and backfill. |
| `MAX_RSS_FEEDS_PER_RUN` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `5` | Set only for services you run. |
| `MAX_URL_FEEDS_PER_RUN` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `1` | Set only for services you run. |
| `MAX_ITEMS_PER_FEED` | Newsletter RSS fetch/rewrite/feed configuration. | server.js, scripts/*, shared utilities | Optional/conditional | `20` | Set only for services you run. |
| `FEED_FETCH_CONCURRENCY` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `2` | Set only for services you run. |
| `RSS_MIN_SOURCE_CHARS` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `220` | Set only for services you run. |
| `RSS_TOPIC_GUARD_MIN_SHARED` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `2` | Set only for services you run. |
| `RSS_TOPIC_GUARD_MIN_OVERLAP` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `0.12` | Set only for services you run. |
| `MIN_SUMMARY_CHARS` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `900` | Set only for services you run. |
| `MAX_SUMMARY_CHARS` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `2400` | Set only for services you run. |

### Script generation / TTS

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `MAX_SSML_CHUNK_BYTES` | AWS Polly and TTS chunk processing configuration. | services/tts | Conditional; required by TTS/podcast audio routes | `4200` | Template value present; current Polly path uses MAX_POLLY_NATURAL_CHUNK_CHARS. |
| `MAX_POLLY_NATURAL_CHUNK_CHARS` | AWS Polly and TTS chunk processing configuration. | services/tts | Conditional; required by TTS/podcast audio routes | `2800` | Set only for services you run. |
| `POLLY_VOICE_ID` | AWS Polly and TTS chunk processing configuration. | services/tts | Conditional; required by TTS/podcast audio routes | `Brian` | Set only for services you run. |
| `TTS_CONCURRENCY` | AWS Polly and TTS chunk processing configuration. | services/tts | Conditional; required by TTS/podcast audio routes | `1` | Set only for services you run. |
| `MAX_CHUNK_RETRIES` | AWS Polly and TTS chunk processing configuration. | services/tts | Conditional; required by TTS/podcast audio routes | `3` | Set only for services you run. |
| `RETRY_DELAY_MS` | Timeout, delay or TTL control in milliseconds. | services/tts | Conditional; required by TTS/podcast audio routes | `1200` | Set only for services you run. |
| `RETRY_BACKOFF_MULTIPLIER` | AWS Polly and TTS chunk processing configuration. | services/tts | Conditional; required by TTS/podcast audio routes | `2` | Set only for services you run. |
| `AWS_REGION` | AWS Polly and TTS chunk processing configuration. | services/tts | Conditional; required by TTS/podcast audio routes | `eu-west-2` | Set only for services you run. |
| `AWS_ACCESS_KEY_ID` | AWS Polly and TTS chunk processing configuration. | services/tts | Conditional; required by TTS/podcast audio routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `AWS_SECRET_ACCESS_KEY` | AWS Polly and TTS chunk processing configuration. | services/tts | Conditional; required by TTS/podcast audio routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |

### Weather / RapidAPI

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `RAPIDAPI_HOST` | Weather API used by script generation. | services/script/utils/getWeatherSummary.js | Optional/conditional | `weatherapi-com.p.rapidapi.com` | Set only for services you run. |
| `RAPIDAPI_KEY` | Weather API used by script generation. | services/script/utils/getWeatherSummary.js | Optional/conditional | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |

### Outreach

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `OUTREACH_KEYWORDS` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `OUTREACH_BATCH_SIZE` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `20` | Set only for services you run. |
| `OUTREACH_MIN_LEAD_SCORE` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Set only for services you run. |
| `OUTREACH_MIN_EMAIL_SCORE` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Set only for services you run. |
| `OUTREACH_PROGRESS_KEY` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `outreach/progress.json` | Secret value; keep in Koyeb/GitHub secret storage. |
| `SERP_RATE_DELAY_MS` | Timeout, delay or TTL control in milliseconds. | services/outreach | Conditional; required by outreach routes | `0` | Set only for services you run. |
| `HUNTER_DELAY_MS` | Timeout, delay or TTL control in milliseconds. | services/outreach | Conditional; required by outreach routes | `0` | Set only for services you run. |
| `ZEROBOUNCE_BATCH_SIZE` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `25` | Set only for services you run. |
| `ZEROBOUNCE_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | services/outreach | Conditional; required by outreach routes | `30000` | Set only for services you run. |
| `ZEROBOUNCE_DELAY_MS` | Timeout, delay or TTL control in milliseconds. | services/outreach | Conditional; required by outreach routes | `600` | Set only for services you run. |
| `API_SERP_KEY` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `API_OPENPAGERANK_KEY` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `API_URLSCAN_KEY` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `API_PROSPEO_KEY` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `API_HUNTER_KEY` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `API_APOLLO_KEY` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `API_ZERO_KEY` | Outreach provider, score or batch setting. | services/outreach | Conditional; required by outreach routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |

### Google Sheets

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `GOOGLE_CLIENT_EMAIL` | Google service-account / Sheets target configuration. | services/outreach/services/sheetService.js and scripts/sheetService.js | Conditional; required by outreach routes | `blank` | Set only for services you run. |
| `GOOGLE_PRIVATE_KEY` | Google service-account / Sheets target configuration. | services/outreach/services/sheetService.js and scripts/sheetService.js | Conditional; required by outreach routes | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `GOOGLE_SHEET_ID` | Google service-account / Sheets target configuration. | services/outreach/services/sheetService.js and scripts/sheetService.js | Conditional; required by outreach routes | `blank` | Set only for services you run. |

### Blog

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `BLOG_WEEK_DAYS` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Optional/conditional | `7` | Template value present; current route reads body days/weekId instead. |
| `BLOG_RSS_OBJECT_KEY` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Optional/conditional | `feed.xml` | Secret value; keep in Koyeb/GitHub secret storage. |
| `BLOG_PREFIX` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Optional/conditional | `blog` | Set only for services you run. |
| `BLOG_SOCIAL_PREFIX` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Optional/conditional | `social-media-blog` | Set only for services you run. |
| `BLOG_SOCIAL_RSS_OBJECT_KEY` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Optional/conditional | `social-media-blog/feed.xml` | Secret value; keep in Koyeb/GitHub secret storage. |
| `BLOG_SOCIAL_RSS_TITLE` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Optional/conditional | `Jonathan Harris | Daily AI Social Briefings` | Set only for services you run. |
| `BLOG_SOCIAL_RSS_DESCRIPTION` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Optional/conditional | `Daily AI briefing posts built for social media: sharp, visual, grounded, and ...` | Set only for services you run. |
| `BLOG_SOCIAL_FALLBACK_IMAGE_URL` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Optional/conditional | `blank` | Set only for services you run. |
| `BLOG_SOCIAL_QA_ENABLED` | Blog publishing, RSS or artwork configuration. | services/blog, services/artwork | Optional/conditional | `true` | Set only for services you run. |

### OneUp social scheduler

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `ONEUP_API_KEY` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `ONEUP_API_BASE` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `https://www.oneupapp.io/api` | Set only for services you run. |
| `ONEUP_TIMEZONE` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `Europe/London` | Set only for services you run. |
| `ONEUP_CATEGORY_NAME_GENERAL` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `General` | Set only for services you run. |
| `ONEUP_SOCIAL_NETWORK_ID` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `ALL` | Set only for services you run. |
| `ONEUP_DEFAULT_DRY_RUN` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `false` | Set only for services you run. |
| `ONEUP_RSS_LOOKBACK_DAYS` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `7` | Set only for services you run. |
| `ONEUP_QUEUE_GUARD_LOOKBACK_PAGES` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `2` | Set only for services you run. |
| `ONEUP_MONDAY_TIME` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `14:00` | Set only for services you run. |
| `ONEUP_TUESDAY_TIME` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `13:00` | Set only for services you run. |
| `ONEUP_WEDNESDAY_TIME` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `12:20` | Set only for services you run. |
| `ONEUP_THURSDAY_TIME` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `12:20` | Set only for services you run. |
| `ONEUP_FRIDAY_TIME` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `11:20` | Set only for services you run. |
| `ONEUP_SATURDAY_TIME` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `10:30` | Set only for services you run. |
| `ONEUP_SUNDAY_TIME` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `18:00` | Set only for services you run. |
| `ONEUP_QUIZ_QUESTION_TIME` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `12:00` | Set only for services you run. |
| `ONEUP_QUIZ_ANSWER_TIME` | OneUp API, lane time, image, category or scheduling configuration. | services/oneup | Conditional; required to schedule; dry-run can work without API key | `12:00` | Set only for services you run. |

### e.g. RSS_LINKS_BASE_URL=https://links.yoursite.com

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `RSS_LINKS_BASE_URL` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `blank` | Template ahead of current implementation; see legacy notes. |
| `RSS_LINKS_PATH_PREFIX` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `/rss-links` | Template ahead of current implementation; see legacy notes. |

### Default is "true" (same long URL always returns the same short code).

| Name | Purpose | Used by | Required | Default/template | Notes |
|---|---|---|---|---|---|
| `RSS_LINKS_UNIQUE` | Newsletter RSS fetch/rewrite/feed configuration. | routes/rss.js, services/rss-feed-creator | Optional/conditional | `true` | Template ahead of current implementation; see legacy notes. |
| `OPENROUTER_ANTHROPIC` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Optional/conditional | `blank` | Set only for services you run. |
| `OPENROUTER_GOOGLE` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Optional/conditional | `blank` | Set only for services you run. |
| `OPENROUTER_CHATGPT` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Optional/conditional | `blank` | Set only for services you run. |
| `OPENROUTER_API_KEY_ANTHROPIC` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by audit workflows when used | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `OPENROUTER_API_KEY_GOOGLE` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by audit workflows when used | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `OPENROUTER_API_KEY_CHATGPT` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by audit workflows when used | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `OPENROUTER_API_KEY_META` | OpenRouter model, key or request-control configuration. | services/shared/utils/ai-config.js, ai-service.js | Conditional; required by audit workflows when used | `blank` | Secret value; keep in Koyeb/GitHub secret storage. |
| `AUDIT_AI_MAX_TOKENS` | Audit workflow, AI or timeout configuration. | audits/utils/*, deployment-check.js | Conditional; required by audit workflows when used | `9000` | Secret value; keep in Koyeb/GitHub secret storage. |
| `AUDIT_AI_TIMEOUT_MS` | Timeout, delay or TTL control in milliseconds. | audits/utils/*, deployment-check.js | Conditional; required by audit workflows when used | `240000` | Set only for services you run. |
| `AUDIT_AI_MAX_RETRIES` | Audit workflow, AI or timeout configuration. | audits/utils/*, deployment-check.js | Conditional; required by audit workflows when used | `0` | Set only for services you run. |
| `AUDIT_AI_RETRY_BASE_MS` | Timeout, delay or TTL control in milliseconds. | audits/utils/*, deployment-check.js | Conditional; required by audit workflows when used | `500` | Set only for services you run. |
| `AUDIT_AI_TEMPERATURE` | Audit workflow, AI or timeout configuration. | audits/utils/*, deployment-check.js | Conditional; required by audit workflows when used | `0.15` | Set only for services you run. |
| `AUDIT_AI_TOP_P` | Audit workflow, AI or timeout configuration. | audits/utils/*, deployment-check.js | Conditional; required by audit workflows when used | `0.95` | Set only for services you run. |
| `AUDIT_ANALYSIS_MAX_WAIT_SECONDS` | Audit workflow, AI or timeout configuration. | audits/utils/*, deployment-check.js | Conditional; required by audit workflows when used | `900` | Set only for services you run. |


### Variables used in code but absent from `env.template`

These names were found in runtime code or deployment checks but are not present in the supplied `env.template`.

| Name | Area | Purpose | Required | Notes |
|---|---|---|---|---|
| `AI_SUITE_AUDIT_CALLBACK_TOKEN` | audits | Alternative audit callback token name accepted by callback auth. | Conditional | Use `AUDIT_CALLBACK_TOKEN` where possible. |
| `AUDIT_CALLBACK_BASE_URL` | audits | Override public callback base URL for dispatched audit workflows. | Conditional | Falls back to `APP_URL`. |
| `AUDIT_CALLBACK_TOKEN` | audits | Bearer/shared token for audit callbacks and analysis endpoints. | Conditional | Required by audit dispatch/callback routes. |
| `AUDIT_RUN_REUSE_ACTIVE_MS` | audits | Window for reusing an active audit job instead of dispatching another. | Optional | Defaults to 20 minutes. |
| `AUDIT_WEBSITE_REPO_REF` | audits | Default Git ref for website audit workflow dispatch. | Optional | Defaults to `main`. |
| `ARTWORK_MAX_TOKENS` | artwork | Referenced by artwork utilities for image prompt/model budget where implemented. | Optional | Absent from env.template. |
| `BACKFILL_TRANSCRIPT_HTML` | bootstrap/scripts | Runs transcript HTML backfill during bootstrap when set to true. | Optional | Disabled by default. |
| `BACKFILL_TRANSCRIPT_HTML_TIMEOUT_MS` | bootstrap/scripts | Timeout for optional transcript HTML backfill step. | Optional | Defaults to 600000. |
| `BLOG_RSS_FEED_URL` | blog | Explicit weekly blog RSS public feed URL. | Optional | Falls back to R2 public URL. |
| `BLOG_RSS_TITLE` | blog | Weekly blog RSS channel title. | Optional | Default in code. |
| `BLOG_RSS_DESCRIPTION` | blog | Weekly blog RSS channel description. | Optional | Default in code. |
| `BLOG_RSS_IMAGE_URL` | blog/artwork | Weekly/blog RSS image and fallback image source. | Optional | Default in code or blank fallback. |
| `BLOG_RSS_PUBLIC_VERIFY_ATTEMPTS` | blog | Public RSS verification attempts before the website rebuild hook is allowed to run. | Optional | `5` | Cache-busted fail-closed publication handoff. |
| `BLOG_RSS_PUBLIC_VERIFY_BASE_MS` | blog | Base delay for exponential public RSS verification retries. | Optional | `750` | Milliseconds. |
| `BLOG_RSS_PUBLIC_VERIFY_TIMEOUT_MS` | blog | Per-attempt timeout while verifying the newly published post is visible in public RSS. | Optional | `10000` | Milliseconds. |
| `BLOG_SOCIAL_PUBLIC_BASE_URL` | blog social | Public base URL for social blog hub/feed links. | Optional | Default in code. |
| `BLOG_SOCIAL_PUBLIC_POSTS_BASE_URL` | blog social | Public base URL for social blog post links. | Optional | Default in code. |
| `BLOG_WEEKLY_QA_ENABLED` | blog weekly | Enables/disables extra weekly blog brand QA pass. | Optional | Defaults to true. |
| `FEATURED_BOOK_API_URL` | oneup/script sponsor | Featured-book API source used by sponsor/ebook workflows. | Optional | Fallback catalogue may be used. |
| `ONEUP_CATEGORY_NAME_EBOOKS` | oneup | Category name for weekly ebook posts. | Optional/conditional | Default in code: Ebooks. |
| `ONEUP_DAILY_MAX_TOKENS` | oneup | Max token budget for daily lane generation. | Optional | Default in code. |
| `ONEUP_EBOOK_CATALOGUE_PATH` | oneup | Override path to ebook catalogue. | Optional | Local services/oneup/data is default. |
| `ONEUP_EBOOK_MAX_TOKENS` | oneup | Max token budget for ebook posts. | Optional | Default in code. |
| `ONEUP_EBOOK_TUESDAY_TIME` | oneup | Tuesday ebook post time override. | Optional | Falls back to ONEUP_TUESDAY_TIME. |
| `ONEUP_EBOOK_THURSDAY_TIME` | oneup | Thursday ebook post time override. | Optional | Falls back to ONEUP_THURSDAY_TIME. |
| `ONEUP_EBOOK_SATURDAY_TIME` | oneup | Saturday ebook post time override. | Optional | Falls back to ONEUP_SATURDAY_TIME. |
| `ONEUP_MONDAY_IMAGE_URL` | oneup | Daily lane image URL override. | Optional | Default image domain in code. |
| `ONEUP_TUESDAY_IMAGE_URL` | oneup | Daily lane image URL override. | Optional | Default image domain in code. |
| `ONEUP_WEDNESDAY_IMAGE_URL` | oneup | Daily lane image URL override. | Optional | Default image domain in code. |
| `ONEUP_THURSDAY_IMAGE_URL` | oneup | Daily lane image URL override. | Optional | Default image domain in code. |
| `ONEUP_FRIDAY_IMAGE_URL` | oneup | Daily lane image URL override. | Optional | Default image domain in code. |
| `ONEUP_SATURDAY_IMAGE_URL` | oneup | Daily lane image URL override. | Optional | Default image domain in code. |
| `ONEUP_SUNDAY_IMAGE_URL` | oneup | Daily lane image URL override. | Optional | Default image domain in code. |
| `ONEUP_QUIZ_IMAGE_URL` | oneup | Quiz question image URL override. | Optional | Default image domain in code. |
| `ONEUP_QUIZ_ANSWER_IMAGE_URL` | oneup | Quiz answer image URL override. | Optional | Default image domain in code. |
| `ONEUP_QUIZ_MAX_TOKENS` | oneup | Max token budget for quiz generation. | Optional | Default in code. |
| `ON_BRAND_AUDIT_MAX_TOKENS` | audits/on-brand | Max token budget for on-brand audit report generation. | Optional | Default in code. |
| `ON_BRAND_AUDIT_TEMPERATURE` | audits/on-brand | Temperature for on-brand audit generation. | Optional | Default in code. |
| `ON_BRAND_AUDIT_TIMEOUT_MS` | audits/on-brand | Timeout for on-brand AI calls. | Optional | Default in code. |
| `OPENROUTER_API_KEY_ART` | OpenRouter/artwork | Provider-specific artwork key fallback. | Optional | Prefer shared OPENROUTER_API_KEY unless separating keys. |
| `OPENROUTER_API_KEY_ART_BACKUP` | OpenRouter/artwork | Provider-specific backup artwork key fallback. | Optional | Prefer shared OPENROUTER_API_KEY unless separating keys. |
| `OPENROUTER_DATA_COLLECTION` | OpenRouter | Sets OpenRouter provider data-collection preference. | Optional | Used in provider preferences. |
| `OPENROUTER_PROVIDER_ORDER` | OpenRouter | Preferred provider order for OpenRouter calls. | Optional | Comma-separated. |
| `OPENROUTER_PROVIDER_ONLY` | OpenRouter | Restricts OpenRouter providers. | Optional | Comma-separated. |
| `OPENROUTER_PROVIDER_IGNORE` | OpenRouter | Excludes OpenRouter providers. | Optional | Comma-separated. |
| `OPENROUTER_REQUIRE_PARAMETERS` | OpenRouter | Global OpenRouter `require_parameters` override. | Optional | JSON route has separate setting in template. |
| `PODCAST_ARTWORK_TIMEOUT_MS` | artwork/podcast | Timeout for podcast artwork generation. | Optional | Falls back to ARTWORK_TIMEOUT_MS/AI_TIMEOUT. |
| `PODCAST_DURATION_MINS` | script/podcast | Compatibility duration target name. | Optional | Prefer PODCAST_TARGET_MINUTES where possible. |
| `PODCAST_DURATION_MINUTES` | script/podcast | Compatibility duration target name. | Optional | Prefer PODCAST_TARGET_MINUTES where possible. |
| `PODCAST_TARGET_MINS` | script/podcast | Compatibility duration target name. | Optional | Prefer PODCAST_TARGET_MINUTES where possible. |
| `PODCAST_FALLBACK_IMAGE_URL` | artwork/podcast | Fallback podcast image URL if generation fails. | Optional | Used before/with episode-specific fallback. |
| `PODCAST_FALLBACK_EPISODE_IMAGE_URL` | artwork/podcast | Episode image fallback if artwork generation fails. | Optional | Fallback name used in code. |
| `PODCAST_TRANSCRIPT_HTML_BASE_URL` | script/tts/podcast RSS | Public base for generated HTML transcripts. | Optional | Falls back to transcript R2/site paths. |
| `R2_BUCKET_BRAND_ASSETS` | R2/deployment | Brand-assets bucket used by deployment-check and shared aliases. | Conditional | Absent from env.template, but deployment-check requires it. |
| `R2_BUCKET_PODCAST_OUTPUT` | R2 compatibility | Legacy podcast-output bucket alias read by shared R2 client. | Legacy/optional | Prefer R2_BUCKET_PODCAST. |
| `R2_BUCKET_RAW_TEXT_INPUT` | R2 compatibility | Legacy raw-text-input bucket alias read by shared R2 client. | Legacy/optional | Prefer R2_BUCKET_RAW_TEXT. |
| `R2_PUBLIC_BASE_URL_BRAND_ASSETS` | R2/deployment | Public base for brand assets. | Conditional | Absent from env.template, but deployment-check requires it. |
| `R2_PUBLIC_BASE_URL_PODCAST_OUTPUT` | R2 compatibility | Legacy podcast public URL fallback. | Legacy/optional | Prefer R2_PUBLIC_BASE_URL_PODCAST. |
| `R2_PUBLIC_BASE_URL_RSS_FEEDS` | R2 compatibility | Legacy RSS public URL fallback. | Legacy/optional | Prefer R2_PUBLIC_BASE_URL_RSS. |
| `R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML` | R2 transcripts | Public base for transcript HTML. | Optional/conditional | Used before text transcript URL in several places. |
| `RSS_INCLUDE_WRAPPER_CTA` | rss-feed-creator | Optional wrapper CTA inclusion in newsletter RSS output. | Optional | Absent from env.template. |
| `SITE_BASE_URL` | blog/podcast | Canonical website base used for post, episode and transcript links. | Optional | Defaults to jonathan-harris.online in code. |
| `WEBSITE_REBUILD_HOOK` | blog/podcast/CI | Webhook called after publishing workflows to rebuild the website. | Conditional | Should be stored as a secret. |
| `WEBSITE_REBUILD_HOOK_FALLBACK` | blog/podcast | Fallback rebuild webhook URL. | Optional | Secret if it embeds private hook tokens. |

### Appears unused, legacy, or template-ahead-of-code

| Name | Evidence | Current status |
|---|---|---|
| `CF_EMAIL` | In `env.template`; purge utility uses `CF_purge` bearer token and `CF_zone`. | Appears legacy/unused. |
| `RSS_LINKS_BASE_URL` | In `env.template`; `services/rss-links/service.js` builds short URLs with `buildPublicUrl("rss", ...)`. | Template ahead of current implementation. |
| `RSS_LINKS_PATH_PREFIX` | In `env.template`; not read by current RSS links code. | Template ahead of current implementation. |
| `RSS_LINKS_UNIQUE` | In `env.template`; current code always deduplicates by URL hash. | Template ahead of current implementation. |
| `MAX_SSML_CHUNK_BYTES` | In `env.template`; Polly TTS processor reads `MAX_POLLY_NATURAL_CHUNK_CHARS`. | Appears legacy for current Polly path. |
| `BLOG_WEEK_DAYS` | In `env.template`; weekly blog route reads request `days`/`weekId` and defaults in code. | Appears legacy or not currently wired. |
| `services/api/index.js` env impact | Service exists but route registry does not mount it. | Not an env var, but useful compatibility note. |

## Storage and external integrations

### Cloudflare R2

`services/shared/utils/r2-client.js` defines aliases used across the codebase. Service code normally calls aliases such as `podcast`, `rawtext`, `meta`, `rss`, `podcastRss`, `blog`, `blogImages`, `blogRss`, `audits` and `metasystem` rather than raw bucket names.

| Alias | Bucket env | Public URL env | Main use |
|---|---|---|---|
| `podcast` | `R2_BUCKET_PODCAST` | `R2_PUBLIC_BASE_URL_PODCAST` | Final podcast MP3 files. |
| `rawtext` / `raw-text` | `R2_BUCKET_RAW_TEXT` | `R2_PUBLIC_BASE_URL_RAW_TEXT` | Script chunks and raw text assets. |
| `chunks` | `R2_BUCKET_CHUNKS` or fallback `R2_BUCKET_RAW` | `R2_PUBLIC_BASE_URL_CHUNKS` | Raw MP3 chunks from Polly. |
| `meta` | `R2_BUCKET_META` | `R2_PUBLIC_BASE_URL_META` | Episode metadata JSON. |
| `metasystem` | `R2_BUCKET_META_SYSTEM` | `R2_PUBLIC_BASE_URL_META_SYSTEM` | Durable job state, Request dedupe, outreach progress and system files. |
| `merged` | `R2_BUCKET_MERGED` | `R2_PUBLIC_BASE_URL_MERGE` | Merged audio before editing. |
| `edited` | `R2_BUCKET_EDITED_AUDIO` | `R2_PUBLIC_BASE_URL_EDITED_AUDIO` | Edited/mastered audio before final podcast mixdown. |
| `art` | `R2_BUCKET_ART` | `R2_PUBLIC_BASE_URL_ART` | Podcast/direct artwork. |
| `rss` | `R2_BUCKET_RSS_FEEDS` | `R2_PUBLIC_BASE_URL_RSS` | Newsletter RSS, feed JSON, RSS link records and redirect pages. |
| `podcastRss` | `R2_BUCKET_PODCAST_RSS_FEEDS` | `R2_PUBLIC_BASE_URL_PODCAST_RSS` | Podcast RSS XML. |
| `transcript` / `transcripts` | `R2_BUCKET_TRANSCRIPTS` | `R2_PUBLIC_BASE_URL_TRANSCRIPT_HTML` or `R2_PUBLIC_BASE_URL_TRANSCRIPT` | Podcast transcripts. |
| `blog` | `R2_BUCKET_BLOG` | `R2_PUBLIC_BASE_URL_BLOG` | Blog post HTML, sidecar JSON and manifests. |
| `blogImages` | `R2_BUCKET_BLOG_IMAGES` | `R2_PUBLIC_BASE_URL_BLOG_IMAGES` | Blog/social artwork. |
| `blogRss` | `R2_BUCKET_BLOG_RSS` | `R2_PUBLIC_BASE_URL_BLOG_RSS` | Weekly and social blog RSS XML. |
| `audits` | `R2_BUCKET_AUDITS` | `R2_PUBLIC_BASE_URL_AUDITS` | Audit requests, latest pointers, reports and analysis artefacts. |
| `brandAssets` | `R2_BUCKET_BRAND_ASSETS` | `R2_PUBLIC_BASE_URL_BRAND_ASSETS` | Compatibility/deployment-check brand asset bucket. |

### OpenRouter model routing

- `services/shared/utils/ai-config.js` defines provider/model registry and route-specific model chains.
- `services/shared/utils/ai-service.js` sends `/chat/completions` requests to OpenRouter, applies selective Headroom pre-compression, provider preferences, retries, fallbacks, caller cancellation, usage logging and diagnostics.
- Route keys include `intro`, `main`, `outro`, `compose`, `scriptMain`, `scriptMainSynthesis`, `editorialPass`, `metadata`, `artworkImage`, `rssRewrite`, `blogWeekly`, `blogSocial`, `onBrandAudit`, `auditForensic`, `zernioDaily`, `zernioQuiz`, `zernioEbook`, newsletter routes, Blotato routes and Comms Hub routes.

### AWS Polly

- `services/tts/utils/ttsProcessor.js` uses `@aws-sdk/client-polly`.
- Required for TTS: AWS credentials, `AWS_REGION`, `POLLY_VOICE_ID`, R2 audio buckets, and public URL configuration.
- Polly uses the `neural` engine and outputs MP3.

### PodcastIndex

- `services/shared/utils/podcastIndexClient.js` signs PodcastIndex hub notifications.
- `services/rss-feed-podcast/index.js` calls `notifyHubByUrl` when `AUTO_CALL=yes` and PodcastIndex credentials are configured.

### Request deduplication

- Idempotency headers are used for idempotency, not authentication.
- Supported headers: `x-idempotency-key` and `x-trigger-run-key`.
- Dedupe records are persisted via shared state when durable R2 state is enabled.

### OneUp

- `services/oneup/utils/oneupClient.js` uses OneUp endpoints `listcategory`, `listcategoryaccount`, `getscheduledposts`, `getpublishedposts`, `scheduletextpost` and `scheduleimagepost`.
- `ONEUP_API_KEY` is required for live scheduling. Missing API key causes scheduling code to return dry-run previews in some paths.

### Google APIs / Sheets

- Outreach accepted lead batches are stored in `R2_BUCKET_COMMS_HUB` under the `outreach/leads/` prefix.
- Outreach no longer depends on Google Sheets for lead persistence.

### Outreach providers

Evidence in `services/outreach/services/outreachCore.js` and `zeroBounceBatch.js` shows these integrations:

- SERP API via `https://serpapi.com/search` and `API_SERP_KEY`.
- OpenPageRank via `API_OPENPAGERANK_KEY`.
- urlscan.io via `API_URLSCAN_KEY`.
- Prospeo via `API_PROSPEO_KEY`.
- Hunter via `API_HUNTER_KEY`.
- Apollo via `API_APOLLO_KEY`.
- ZeroBounce batch validation via `API_ZERO_KEY`.

### Cloudflare purge

- `services/cloudflare-purge/utils/purgeCloudflareCache.js` uses the Cloudflare v4 purge endpoint.
- It requires a Cloudflare zone ID via `CF_zone`, `CF_ZONE`, `CLOUDFLARE_ZONE_ID`, or `CLOUDFLARE_ZONE`.
- It requires an outbound Cloudflare API token via `CF_purge`, `CF_PURGE`, `CLOUDFLARE_PURGE_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, or `CF_API_TOKEN`.
- `/cloudflare/purge` accepts suite bearer, the legacy `x-cloudflare-purge-secret`, or no inbound auth, because it is used by webhook-style automation. The outbound Cloudflare credentials still have to be valid.

## Workflow documentation

### Podcast pipeline

Evidence: `services/podcast/index.js`, `services/podcast/runPodcastPipeline.js`.

1. `POST /podcast/run` validates an optional `sessionId`.
2. The route creates or reuses an async job in the shared job store.
3. `runPodcastPipeline(sessionId)` runs:
   1. `getScriptForPodcast` through the script orchestrator.
   2. `processArtwork` through podcast artwork generation.
   3. `orchestrateTTS` for audio generation and mastering.
   4. `runRssFeedCreator` from the podcast RSS service.
   5. Session cleanup and temporary-memory cleanup.
   6. Website rebuild webhook call with retry/fallback logic.
4. `GET /podcast/status/:sessionId` reads job state.

### Script generation

Evidence: `services/script/routes/index.js`, `services/script/utils/orchestrator.js`.

1. Generate intro, main and outro text through route-specific OpenRouter model chains.
2. Compose the episode with `composeEpisode`.
3. Validate transcript structure.
4. Run `runEditorialPass`.
5. Apply local `editAndFormat` cleanup.
6. Chunk text with `chunkText`.
7. Upload chunks to R2 alias `rawtext` as `<sessionId>/chunk-###.txt`.
8. Upload full transcript to R2 alias `transcript` as `<sessionId>.txt`.
9. Generate metadata with `generateEpisodeMetaLLM` and attach episode numbers.
10. Upload metadata to R2 alias `meta` as `<sessionId>.json`.
11. Generate optional HTML transcript as `<sessionId>.html`.

### TTS orchestration and merge/edit flow

Evidence: `services/tts/routes/tts.js`, `services/tts/utils/orchestrator.js`, `ttsProcessor.js`, `mergeProcessor.js`, `editingProcessor.js`, `podcastProcessor.js`.

1. `POST /tts/orchestrate` starts an async job and returns immediately with `202`.
2. `orchestrateTTS` loads text chunks from R2 alias `rawtext`.
3. `ttsProcessor` sends each chunk to AWS Polly and stores MP3 chunks in R2 alias `chunks`.
4. `mergeProcessor` merges MP3 chunk URLs with FFmpeg and stores merged audio in R2 alias `merged`.
5. `editingProcessor` applies FFmpeg editing and stores edited audio in R2 alias `edited` or returns a local edited file path.
6. `podcastProcessor` downloads intro/outro audio, concatenates intro + edited main + outro, uploads final MP3 to R2 alias `podcast`, and updates the episode metadata in R2 alias `meta`.
7. `GET /tts/status/:sessionId` reads job state.

### Podcast RSS generation

Evidence: `services/rss-feed-podcast/index.js`, `generateFeed.js`, `xmlBuilder.js`.

1. List JSON metadata files from R2 alias `meta`.
2. Filter out non-episode metadata files.
3. Build RSS channel metadata from `PODCAST_*` variables.
4. Map episode metadata to RSS items; items require `sessionId`, `title` and `podcastUrl`.
5. Upload `turing-torch.xml` to R2 alias `podcastRss`.
6. If enabled, notify PodcastIndex.

### RSS feed creation/rewrite workflow

Evidence: `routes/rss.js`, `services/rss-feed-creator/rewrite-pipeline.js`, `utils/fetchFeeds.js`, `utils/models.js`, `utils/feedGenerator.js`.

1. Fetch source feed/url lists from R2 or local `services/rss-feed-creator/data/*` files.
2. Rotate through feed sources using R2 rotation state.
3. Fetch RSS/Atom items and configured URL sources.
4. Filter by age, future date, duplicate link/title and configured limits.
5. Rewrite suitable items through OpenRouter.
6. Enforce minimum source length and topic guard settings.
7. Create short links through `services/rss-links/service.js` where the rewrite code calls it.
8. Merge new items with existing feed data.
9. Write `feed.xml` and `feed.json` to R2 alias `rss`.

### Weekly blog publishing workflow

Evidence: `services/blog/weekly/buildWeeklyBlogPost.js`.

1. Load rewritten RSS JSON from R2 alias `rss`.
2. Build a date window from `weekId`, `days`, or previous complete ISO week.
3. Normalise source RSS items within the window.
4. Generate structured weekly blog package through OpenRouter.
5. Run local brand validation and optional additional QA.
6. Generate blog artwork through `createBlogArtwork`; use fallback if configured.
7. Write post HTML, sidecar `post.json`, and `posts.json` manifest to R2 alias `blog` under `BLOG_PREFIX`.
8. Publish weekly blog RSS through `publishBlogRssFeed` to R2 alias `blogRss`.
9. Trigger website rebuild hook.

### Blog RSS rebuild

Evidence: `services/blog/routes/rss.js`, `services/blog/rss/publishBlogRssFeed.js`.

1. Load the existing manifest from R2 alias `blog`.
2. Generate RSS XML from manifest items.
3. Write RSS XML to R2 alias `blogRss` using `BLOG_RSS_OBJECT_KEY`.

### Daily/social blog workflow

Evidence: `services/blog/social/buildDailySocialBlogPost.js`, `publishSocialBlogRssFeed.js`.

1. Load rewritten RSS JSON from R2 alias `rss`.
2. Build a daily or rolling date window.
3. Skip existing post for the same date unless `force=true`.
4. Generate structured social blog package through OpenRouter.
5. Run local validation and optional QA.
6. Generate social artwork unless `dryRun=true`.
7. Publish post HTML, sidecar JSON and manifest under `BLOG_SOCIAL_PREFIX` in R2 alias `blog`.
8. Publish social blog RSS to R2 alias `blogRss`.
9. Trigger website rebuild hook.

### OneUp scheduling workflow

Evidence: `services/oneup/routes/social.js`, `utils/socialScheduler.js`, `utils/oneupClient.js`.

- Daily lanes use route `/oneup/daily/:laneKey` with lane keys `monday` through `sunday`.
- The scheduler generates JSON content through OpenRouter, adds configured hashtags, checks queued posts for likely duplicates and calls OneUp scheduling endpoints unless dry-run mode applies.
- Weekly ebook posts create Tuesday, Thursday and Saturday posts using a provided featured book, podcast featured-book data, or local ebook catalogue fallback.
- Weekly quiz posts create a question post and answer post.

### Outreach keyword/batch workflow

Evidence: `services/outreach/routes/index.js`, `services/outreach/services/*.js`.

1. `POST /outreach/keyword` runs one keyword.
2. `serpLookup` fetches up to 50 Google organic results from SERP API.
3. Domains are deduplicated and blocked if they match junk/support/social/reference patterns.
4. Allowed domains are enriched with Prospeo, Hunter and Apollo where keys exist.
5. urlscan and OpenPageRank provide editorial/authority signals where keys exist.
6. ZeroBounce batch validation validates discovered emails if configured.
7. Leads are scored using `OUTREACH_MIN_LEAD_SCORE` and `OUTREACH_MIN_EMAIL_SCORE`.
8. Accepted leads are appended to Google Sheets.
9. Batch mode reads `OUTREACH_KEYWORDS`, advances a cursor and stores progress in R2 metasystem state when available.

### SEO/AEO/GEO audit workflow

Evidence: `audits/routes/seoAeoGeo.js`, `audits/utils/orchestrator.js`, `audits/utils/seoAeoGeoAnalysis.js`.

1. `POST /audits/seo-aeo-geo/run` validates audit run body.
2. The route dispatches a GitHub Actions workflow named `seo-aeo-geo-forensic.yml` by default.
3. Callback and analysis URLs are built from `AUDIT_CALLBACK_BASE_URL` or `APP_URL`.
4. Request metadata and latest status are written to the R2 audits bucket.
5. The external workflow calls `/audits/seo-aeo-geo/analysis` with inventory evidence.
6. The analysis route starts an async AI analysis job and publishes report artefacts to the R2 audits bucket.
7. The external workflow calls `/audits/seo-aeo-geo/callback` with final artefact URLs.

### Mobile UX audit workflow

Evidence: `audits/routes/mobileUx.js`, `audits/utils/orchestrator.js`.

1. `POST /audits/mobile-ux/run` dispatches `mobile-ux-hard-gate.yml` by default.
2. Default exclude patterns for this audit are `/podcast` and `/blog`, unless request body provides `excludePatterns`.
3. Callback is protected by the audit callback token.
4. Completed artefact URLs must be inside `R2_PUBLIC_BASE_URL_AUDITS`.
5. Completion cleans the audit prefix and keeps selected report artefacts.

### On-brand audit workflow

Evidence: `audits/routes/onBrand.js`, `audits/utils/onBrandAudit.js`, `onBrandEvidence.js`.

1. `POST /audits/on-brand/run` runs locally rather than dispatching GitHub Actions.
2. It can collect evidence from OneUp published posts, podcast transcripts and RSS output.
3. It performs deterministic checks and AI-assisted analysis.
4. Recommendations are framed as future QA improvements for future posts, transcripts and RSS output.
5. It publishes JSON and HTML audit artefacts to the R2 audits bucket unless `dryRun=true`.

### Artwork generation

Evidence: `services/artwork/routes/generateArtwork.js`, `createBlogArtwork.js`, `createPodcastArtwork.js`.

- Direct route: `POST /artwork/generate` generates a PNG and stores it in R2 alias `art`.
- Blog artwork: stores PNGs in R2 alias `blogImages`.
- Podcast artwork: stores PNGs in R2 alias `art` and can fall back to configured fallback image URLs.
- Provider list is resolved through `services/artwork/utils/openrouterProviders.js` and shared OpenRouter AI config.

### Cloudflare purge

Evidence: `services/cloudflare-purge/routes/index.js`, `utils/purgeCloudflareCache.js`.

1. `POST /cloudflare/purge` optionally checks `x-cloudflare-purge-secret`.
2. Zod schema requires exactly one purge mode.
3. Utility calls Cloudflare API `/zones/:zone/purge_cache` with bearer token from `CF_purge`.
4. Cloudflare errors are normalised into HTTP errors.

### RSS short-link creation and redirect

Evidence: `services/rss-links/service.js`, `store.js`, `routes/*.js`.

1. `POST /rss-links/shorten` validates absolute HTTP/HTTPS URL.
2. URL is normalised and hashed with SHA-512.
3. Existing URL hash returns existing key.
4. New key is generated using a random alphanumeric helper.
5. Record JSON, URL index JSON and redirect HTML are stored in R2 alias `rss`.
6. `GET /rss-links/:key` loads the record and redirects to the original URL, preserving the request query string.

## Data contracts

### Representative request examples

#### Start podcast pipeline

```json
{
  "sessionId": "TT-2026-05-07"
}
```

Response is asynchronous:

```json
{
  "ok": true,
  "service": "podcast",
  "sessionId": "TT-2026-05-07",
  "status": "queued",
  "statusUrl": "/podcast/status/TT-2026-05-07"
}
```

#### Generate full script

```json
{
  "sessionId": "TT-2026-05-07",
  "date": "2026-05-07",
  "tone": "plain-English editorial",
  "location": "London"
}
```

#### Start TTS

```json
{
  "sessionId": "TT-2026-05-07"
}
```

#### Build weekly blog post

```json
{
  "weekId": "2026-W18"
}
```

or:

```json
{
  "days": 7
}
```

#### Build social blog post dry-run

```json
{
  "date": "2026-05-07",
  "days": 1,
  "dryRun": true,
  "force": false
}
```

#### Schedule OneUp daily lane dry-run

```json
{
  "publishDate": "2026-05-07",
  "dryRun": true,
  "categoryName": "General",
  "socialNetworkId": "ALL"
}
```

#### Outreach keyword

```json
{
  "keyword": "AI automation guest post"
}
```

#### Cloudflare purge one file

```json
{
  "files": ["https://example.com/feed.xml"]
}
```

If `CLOUDFLARE_PURGE_SHARED_SECRET` is configured, include:

```text
x-cloudflare-purge-secret: <configured-secret>
```

#### Create RSS short link

```json
{
  "url": "https://example.com/article"
}
```

#### SEO/AEO/GEO analysis callback payload shape

```json
{
  "sessionId": "seo-aeo-geo-2026-05-07",
  "baseUrl": "https://jonathan-harris.online",
  "inventory": {},
  "priorityPages": [{ "url": "https://jonathan-harris.online/" }],
  "allRoutes": [{ "path": "/" }],
  "repoSignals": {}
}
```

### Shared schema source

Most route request validation is centralised in `services/shared/utils/requestSchemas.js`. Script-specific schemas are in `services/script/utils/schemas.js`. OneUp published-history validation is duplicated locally in `services/oneup/routes/social.js`.

## Testing

### Test command

```bash
npm test
```

### Framework

The repository uses Node’s built-in test runner through `node --test`. `supertest` is available as a dev dependency for route tests.

### Test inventory

| Area | Test files |
|---|---|
| Job store / durable state | `job-store.test.js`, `test/durable-state.test.js` |
| Deployment/startup checks | `test/deployment-check.test.js`, `test/smoke.test.js` |
| OpenRouter routing | `test/openrouter-service-routing.test.js`, `test/ai-service-provider-diagnostics.test.js`, `test/ai-service-audit-timeout.test.js` |
| Audits | `test/audit-analysis-route.test.js`, `test/audit-callback-auth.test.js`, `test/audit-forensic-analysis-shape.test.js`, `test/mobile-ux-audit-service.test.js`, `test/on-brand-audit.test.js` |
| Blog | `test/blog-rss-feed.test.js`, `test/blog-social-package.test.js`, `test/blog-social-rss-feed.test.js`, `test/blog-social-schema.test.js`, `test/blog-weekly-package.test.js` |
| RSS/feed creator | `test/feed-fetching.test.js`, `test/rss-feed-creator-brand.test.js` |
| Podcast RSS/metadata | `test/podcast-metadata.test.js`, `test/podcast-rss-contract.test.js` |
| Script/transcript | `test/scriptValidation.test.js`, `test/transcript-html-template.test.js`, `test/getSponsor.test.js` |
| TTS/audio | `test/merge-processor.test.js` |
| OneUp | `test/oneup-social.test.js` |

### Notable coverage gaps from repository inspection

- No dedicated tests were found for `services/cloudflare-purge`.
- No dedicated tests were found for `services/rss-links`.
- No dedicated route-level tests were found for `services/outreach`.
- The full live podcast pipeline depends on external providers and should be manually tested in a controlled environment.

## Deployment

### Dockerfile behaviour

`Dockerfile` uses `node:20-bookworm-slim`, installs `ffmpeg`, `ca-certificates`, `curl` and `dumb-init`, runs `npm ci --omit=dev`, exposes port `3000`, and starts the app with `npm start`.

### npm scripts

| Command | Behaviour |
|---|---|
| `npm run build` | Echoes `Build step completed`; no compile step. |
| `npm start` | Runs `scripts/bootstrap.js`. |
| `npm run start:server` | Starts `server.js` directly. |
| `npm run check:startup` | Runs `scripts/startupCheck.js`. |
| `npm test` | Runs all Node test files. |
| `npm run test:smoke` | Same command as `npm test`. |

### Koyeb/runtime assumptions evidenced in code

- Server listens on `0.0.0.0` and `PORT`.
- Production durable state is expected through R2 metasystem state unless `ALLOW_EPHEMERAL_STATE=true`.
- `TRUST_PROXY=1` is suitable for a reverse-proxy hosted runtime.
- Audio workflows require FFmpeg/FFprobe, already installed in the Dockerfile.
- Long-running routes use async jobs for podcast and TTS orchestration, returning `202` rather than keeping the HTTP request open.

### CI workflows

| Workflow | Path | Behaviour |
|---|---|---|
| CI sanity | `.github/workflows/ci.yml` | Installs dependencies, verifies app code does not import `scripts/envBootstrap.js`, syntax-checks all JS files and runs `npm test`. |
| Weekly podcast site sync | `.github/workflows/weekly-podcast-site-sync.yml` | Runs every Monday at 08:00 UTC and on manual dispatch. Posts to `WEBSITE_REBUILD_HOOK` secret or code fallback. |

## Operational notes

- **Rate limiting**: In-memory per-process rate limiting. In multi-instance deployments, limits are per instance.
- **Request IDs**: Every logged request gets a request ID from request headers or a UUID.
- **Dedupe**: Request dedupe is idempotency only. It is not request authentication.
- **Durable state**: Production state backend is `auto` by default. With R2 configured, job and dedupe state is stored in R2 metasystem. Without R2, production startup/checks reject local-only state unless explicitly allowed.
- **Temporary directories**: Use `/tmp/ai-management-suite` by default, with service-specific subdirectories for merge/edit/mastering.
- **Timeouts**: AI, feed fetch, artwork, Cloudflare purge, podcast fetch and FFmpeg timeouts are environment-driven.
- **Noisy probes**: Scanner/probe paths are rejected before normal middleware to keep logs cleaner.
- **Error responses**: Routes generally return `{ ok: false, error, requestId }` for failures; some service-level utilities return service-specific objects.

## Troubleshooting

### App does not start

Check:

```bash
npm run check:startup
```

Common causes:

- Missing FFmpeg/FFprobe.
- Missing relative import in a route/service file.
- Production durable state not configured: set R2 credentials plus `R2_BUCKET_META_SYSTEM`, or deliberately set `ALLOW_EPHEMERAL_STATE=true` for disposable environments.
- Invalid `PORT` or host platform not passing the expected port.

### Missing environment variables

Use `deployment-check.js` for the stricter deployment checklist:

```bash
node deployment-check.js
```

It currently requires variables including core app, audit, feed, podcast and brand-assets R2 settings. This check is stricter than simply starting the server.

### R2 upload failures

Check:

- `R2_ENDPOINT`, `R2_REGION`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- The bucket env for the alias used by the failing service.
- Public base URL env when a service needs to return or later fetch a public object URL.
- Bucket permissions for object put/get/list/delete.

### OpenRouter/API failures

Check:

- `OPENROUTER_API_KEY` or provider-specific key fallback.
- Route model variables such as `AI_MODEL_STANDARD`, `AI_MODEL_AUDIT`, `AI_MODEL_IMAGE`.
- `OPENROUTER_BASE_URL` / `OPENROUTER_API_BASE`.
- Provider preference env vars such as `OPENROUTER_PROVIDER_ONLY` or `OPENROUTER_PROVIDER_IGNORE`.
- Route logs for `attemptedProviders`.

### AWS Polly/TTS issues

Check:

- AWS credentials are available in the environment or hosting runtime.
- `AWS_REGION` and `POLLY_VOICE_ID`.
- `MAX_POLLY_NATURAL_CHUNK_CHARS` is not too high.
- Required R2 aliases exist: `rawtext`, `chunks`, `merged`, `edited`, `podcast`, `meta`.

### Podcast merge/edit timeouts

Check:

- FFmpeg/FFprobe installed.
- `PODCAST_FFMPEG_TIMEOUT_MS`, `MERGE_DOWNLOAD_TIMEOUT_MS`, `PODCAST_FETCH_TIMEOUT_MS`.
- Public R2 URLs for chunk/merged/edited audio are reachable.
- Temporary storage under `APP_TMP_DIR` has enough space.

### Blog not publishing

Check:

- Rewritten RSS JSON exists in R2 alias `rss` as `feed.json`.
- `R2_BUCKET_BLOG`, `R2_BUCKET_BLOG_IMAGES`, `R2_BUCKET_BLOG_RSS` and their public URLs.
- OpenRouter model routing for `blogWeekly` or `blogSocial`.
- `BLOG_FALLBACK_IMAGE_URL` / `BLOG_SOCIAL_FALLBACK_IMAGE_URL` if image generation is failing.

### Website rebuild hook not firing

Check:

- `WEBSITE_REBUILD_HOOK` and optional fallback.
- Network egress from runtime.
- Blog/podcast logs for `rebuild.start`, `rebuild.success`, `rebuild.fail`.
- The hook target accepts POST and returns 2xx.

### Audit callback or analysis not appearing

Check:

- `AUDIT_CALLBACK_BASE_URL` or `APP_URL` resolves publicly.
- `AUDIT_CALLBACK_TOKEN` or `AI_SUITE_AUDIT_CALLBACK_TOKEN` matches the token sent by the workflow.
- `GITHUB_TOKEN_WEBSITE_AUDITS`, `AUDIT_WEBSITE_REPO_OWNER`, `AUDIT_WEBSITE_REPO_NAME`, and optional `AUDIT_WEBSITE_REPO_REF`.
- Audit artefact URLs are under `R2_PUBLIC_BASE_URL_AUDITS`.

### OneUp scheduling failure

Check:

- `ONEUP_API_KEY`.
- `ONEUP_CATEGORY_NAME_GENERAL` / `ONEUP_CATEGORY_NAME_EBOOKS` exists in OneUp.
- `ONEUP_SOCIAL_NETWORK_ID` matches OneUp expectations.
- Duplicate guard may prevent scheduling if a similar post is already queued.
- Use `dryRun=true` to inspect generated payloads without scheduling.

### Outreach provider failure

Check:

- `API_SERP_KEY` is required for SERP lookup.
- `OUTREACH_MIN_LEAD_SCORE` and `OUTREACH_MIN_EMAIL_SCORE` must be numeric.
- Google Sheets credentials and target sheet ID.
- Optional provider failures may reduce enrichment quality but do not always stop the scan.
- Production batch progress requires R2 metasystem state unless ephemeral state is explicitly allowed.

### Cloudflare purge failure

Check:

- `CF_zone={{secret.CF_ZONE}}` and `CF_purge={{secret.CF_PURGE}}` are the preferred Koyeb env shapes.
- Avoid unresolved placeholder values such as `CF_purge={{ secret.CF-purge }}`; the service now detects these and returns a configuration error instead of sending a bad bearer token to Cloudflare.
- The inbound purge route no longer requires `x-cloudflare-purge-secret`.
- Request body must specify exactly one purge mode.
- Cloudflare API token must have zone cache purge permissions.

## Maintainer guide

### Add a new service

1. Create a folder under `services/<name>/` or under `audits/` for audit-specific code.
2. Add a router file with explicit route schemas.
3. Mount the router in `routes/index.js`.
4. Add shared logic to `services/shared` only if at least two services need it.
5. Add service README documentation.
6. Add tests under `test/`.
7. Update the root service inventory, route map and env reference.

### Add a new route

1. Keep the full path clear from the mount point plus local route path.
2. Validate request bodies with Zod or an existing schema helper.
3. Use `requestDedupe(scope)` only for webhook-triggered idempotent routes.
4. Return JSON consistently with `ok`, service-specific data and a useful error shape.
5. Add route tests or at least schema tests.
6. Update this README and the service README in the same pull request.

### Add environment variables safely

1. Add the name to `env.template` with a blank or safe placeholder value.
2. Do not commit real secrets.
3. Document purpose, service usage, default and required/optional status.
4. Prefer existing shared variables before adding new aliases.
5. Add compatibility aliases only when code actually reads them.
6. Update deployment docs and Koyeb/GitHub secret guidance.

### Add tests

1. Use Node’s built-in `node:test` runner.
2. Keep external network calls mocked or isolated.
3. Add schema/contract tests for route bodies.
4. Add service-level tests for pure utilities.
5. For R2/state behaviours, prefer temporary local state or explicit test fixtures.

### Keep README and service READMEs in sync

- Root README should hold the service inventory, global route map, env reference and operational model.
- Service READMEs should hold implementation detail, workflow notes, service-specific env and troubleshooting.
- When changing a route, update both the route map and service README.
- When adding or removing env vars, update `env.template`, the root env reference and relevant service README.

### Avoid documenting secrets

- Document secret names, not values.
- Use `<secret>` or `<configured-secret>` in examples.
- Treat webhook URLs as sensitive if they contain private tokens.
- Keep public base URLs separate from API keys/tokens.

## Accuracy pass

This documentation was prepared against the supplied repository structure and these source-of-truth files:

- `package.json`
- `server.js`
- `routes/index.js`
- `routes/rss.js`
- `services/*/routes/*.js`
- `services/*/index.js`
- `audits/routes/*.js`
- `services/shared/utils/requestSchemas.js`
- `services/shared/utils/r2-client.js`
- `services/shared/utils/ai-config.js`
- `Dockerfile`
- `.github/workflows/*.yml`
- `test/*.test.js`
- `env.template`

Routes in this README are active only when they are mounted through `routes/index.js` or root `server.js`. Features marked present but not wired should not be treated as available HTTP endpoints until they are mounted and tested.


## R2 private-readiness

AIMS uses authenticated R2 access for internal/intermediate data. The target-private buckets are `metasystem`, `comms-hub`, `comms-hub-private`, `audits`, `raw-text`, `podcast-chunks`, `podcast-merged`, `podcast-meta`, and `edited`. Legacy public base URLs may remain configured temporarily while HIVE/RAMS/website consumers are migrated; they are compatibility endpoints, not AIMS' primary access path. `hive-skills` deliberately remains public during this transition. Published delivery buckets (podcast audio/artwork/RSS, website/blog assets, transcripts, brand assets) remain public.

Run `npm run r2:policy:check` before deployment to detect access-policy drift. Comms Hub backup/restore storage is not created or enabled in this phase.
