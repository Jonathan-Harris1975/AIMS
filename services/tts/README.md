> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# TTS service

## Status

**Implemented.** This page documents behaviour backed by files in `services/tts/`.

## Purpose

Synthesises script chunks with AWS Polly, stores audio chunks, merges and edits them with FFmpeg, appends intro/outro audio and uploads the final podcast MP3.

## Routes

- `GET /tts/health`
- `POST /tts/orchestrate`
- `GET /tts/status/:sessionId`

## Main files

- `routes/tts.js`
- `utils/orchestrator.js`
- `utils/ttsProcessor.js`
- `utils/mergeProcessor.js`
- `utils/editingProcessor.js`
- `utils/podcastProcessor.js`
- `utils/io.js`, `utils/audio.js`

## Workflow

- Load text chunks from R2 alias `rawtext`.
- Send chunks to AWS Polly using neural MP3 synthesis.
- Upload chunk MP3s to R2 alias `chunks`.
- Merge chunks with FFmpeg into R2 alias `merged`.
- Edit/master audio with FFmpeg into R2 alias `edited` or local path.
- Download intro/outro files and concatenate final podcast.
- Upload final MP3 to R2 alias `podcast`.
- Update episode metadata in R2 alias `meta`.

## Environment variables

- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `POLLY_VOICE_ID`
- `MAX_POLLY_NATURAL_CHUNK_CHARS`, `TTS_CONCURRENCY`, `MAX_CHUNK_RETRIES`, `RETRY_DELAY_MS`, `RETRY_BACKOFF_MULTIPLIER`
- `PODCAST_INTRO_URL`, `PODCAST_OUTRO_URL`, `PODCAST_FFMPEG_TIMEOUT_MS`, `PODCAST_FETCH_TIMEOUT_MS`, `PODCAST_MERGE_TMP_DIR`, `PODCAST_EDIT_TMP_DIR`, `PODCAST_MASTER_TMP_DIR`
- R2 aliases: `rawtext`, `chunks`, `merged`, `edited`, `podcast`, `meta`, transcript public URLs

## External integrations

- AWS Polly
- Cloudflare R2
- FFmpeg/FFprobe

## Storage

- Text input: `rawtext/<sessionId>/chunk-###.txt`.
- Polly chunks: `chunks/<sessionId>/chunk-###.mp3`.
- Final podcast: `podcast/<sessionId>.mp3`.
- Updated metadata: `meta/<sessionId>.json`.

## Tests

`test/merge-processor.test.js`

## Common troubleshooting

- No text chunks found: run script orchestration first.
- Polly errors: check voice, region, AWS credentials and chunk size.
- FFmpeg timeout: increase timeout or inspect corrupted chunks.
- Intro/outro download failure: check public URLs.
- Metadata update failure: check `R2_PUBLIC_BASE_URL_META` and meta object.

## Connections to other services

Consumes script output and feeds podcast pipeline/podcast RSS metadata.
