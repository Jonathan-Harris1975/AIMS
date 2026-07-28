# TTS service

**Live route prefix:** `/tts`

Turns approved podcast scripts into mastered audio. It performs chunking, AWS Polly synthesis, retry handling, chunk storage, FFmpeg merge/edit processing and final podcast asset publication.

## HTTP contract

- `GET /tts/health`
- `POST /tts/orchestrate` — run the full TTS/audio pipeline.
- `GET /tts/status/:sessionId` — inspect processing state.

## Behaviour

Chunk sizing honours Polly/SSML limits. Failed chunks use bounded retries. Merge and editing stages use configurable FFmpeg/download timeouts and cleanup controls. Outputs use dedicated chunks, merged, edited and final podcast R2 buckets. Configure with `AWS_REGION`, Polly credentials/voice, `POLLY_VOICE_ID`, `MAX_CHUNK_RETRIES`, chunk-size limits, merge controls and podcast intro/outro asset URLs.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
