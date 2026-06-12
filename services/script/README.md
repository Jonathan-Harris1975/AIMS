# Script generation service

## Status

**Implemented.** This page documents behaviour backed by files in `services/script/`.

## Purpose

Generates podcast episode scripts, applies editorial shaping, chunks text for TTS, publishes transcripts and writes episode metadata.

## Routes

- `GET /script/health`
- `POST /script/intro`
- `POST /script/main`
- `POST /script/outro`
- `POST /script/compose`
- `POST /script/orchestrate`

## Main files

- `routes/index.js`
- `utils/orchestrator.js`
- `utils/models.js`
- `utils/promptTemplates.js`
- `utils/editorialPass.js`
- `utils/editAndFormat.js`
- `utils/chunkText.js`
- `utils/podcastHelper.js`
- `utils/episodeCounter.js`
- `utils/generateTranscriptHtml.js`
- `utils/getWeatherSummary.js`

## Workflow

- Validate route payload through script Zod schemas.
- Generate intro/main/outro through OpenRouter route chains.
- Compose full episode.
- Validate transcript structure before and after editorial work.
- Run AI editorial pass and local formatting.
- Chunk text and upload TTS chunks to R2.
- Upload text and HTML transcripts.
- Generate metadata and episode number.

## Environment variables

- OpenRouter/AI vars, especially role model vars and `AI_*` controls
- `RAPIDAPI_HOST`, `RAPIDAPI_KEY` for weather summary utility
- `PODCAST_RSS_EP`, `PODCAST_TARGET_MINUTES` and compatibility duration vars
- `SITE_BASE_URL`, `PODCAST_TRANSCRIPT_HTML_BASE_URL`
- R2 aliases `rawtext`, `transcript`, `meta`, `metasystem`

## External integrations

- OpenRouter
- Weather/RapidAPI
- Cloudflare R2

## Storage

- Chunks: `rawtext/<sessionId>/chunk-###.txt`.
- Text transcript: `transcript/<sessionId>.txt`.
- HTML transcript: `transcript/<sessionId>.html`.
- Episode metadata: `meta/<sessionId>.json`.
- Episode counter/system files use metasystem where implemented.

## Tests

- `test/scriptValidation.test.js`
- `test/transcript-html-template.test.js`
- `test/getSponsor.test.js`

## Common troubleshooting

- 400 schema errors: inspect accepted fields in `utils/schemas.js`.
- Empty or malformed model output: inspect OpenRouter provider chain and route logs.
- Transcript validation failure: generated script is missing required structure. Normal spoken time abbreviations such as `a.m.` and `p.m.` are accepted by the punctuation-join guard.
- R2 upload failure: check bucket aliases and public URLs.

## Connections to other services

Feeds TTS orchestration, podcast pipeline and podcast RSS metadata. Uses shared AI, R2, state and session ID utilities.
