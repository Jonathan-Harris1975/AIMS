# Podcast service

## Status

**Implemented.** This page documents behaviour backed by files in `services/podcast/`.

## Purpose

Coordinates the full podcast production pipeline by calling script generation, artwork generation, TTS/audio processing, podcast RSS generation, cleanup and website rebuild hook logic.

## Routes

- `GET /podcast/health`
- `POST /podcast/run`
- `GET /podcast/status/:sessionId`

## Main files

- `index.js` route/job wrapper
- `runPodcastPipeline.js` pipeline implementation

## Workflow

- Validate or default session ID.
- Create/reuse async job.
- Generate or retrieve script assets.
- Generate podcast artwork.
- Run TTS orchestration.
- Rebuild podcast RSS feed.
- Clean temporary/session artefacts.
- Trigger website rebuild hook.
- Store job completion/failure state.

## Environment variables

- `PODCAST_*` feed and processing variables
- `PODCAST_INTRO_URL`, `PODCAST_OUTRO_URL`
- R2 podcast/audio/meta/transcript/art buckets and public URLs
- `WEBSITE_REBUILD_HOOK`, `WEBSITE_REBUILD_HOOK_FALLBACK`
- OpenRouter, AWS Polly and PodcastIndex env through child services

## External integrations

- Script service
- Artwork service
- TTS service
- Podcast RSS service
- Cloudflare R2
- Website rebuild webhook

## Storage

Uses shared job store. Output spans script chunks/transcripts/metadata/art/audio/podcast RSS buckets depending on pipeline stage.

## Tests

- `test/podcast-metadata.test.js`
- `test/podcast-rss-contract.test.js`

## Common troubleshooting

- 202 returned but no completion: inspect `/podcast/status/:sessionId`.
- Script failure: check OpenRouter model routing and RSS/weather inputs.
- Artwork failure: check image model env or fallback image.
- TTS failure: check AWS/R2/FFmpeg settings.
- RSS rebuild failure: inspect episode metadata JSON in R2 alias `meta`.

## Connections to other services

This is an orchestration layer over script, artwork, TTS, rss-feed-podcast and shared cleanup utilities.
