# Podcast pipeline

**Live route prefix:** `/podcast`

Runs the end-to-end Turing's Torch: AI Weekly production workflow. It coordinates source preparation, script generation, editorial QA, TTS, audio processing, artwork, transcript, metadata and podcast RSS publication.

## HTTP contract

- `GET|POST /podcast/readiness` — verify the full Friday production contract without starting work.
- `POST /podcast/run` — start a full episode pipeline.
- `GET /podcast/status/:sessionId` — inspect pipeline state.
- `GET /podcast/health` — readiness/health.

## Behaviour

The pipeline is intentionally the longest weekly operation and runs in the dedicated Friday PM sequence after a side-effect-free readiness check. Blotato posts are prepared during the morning window, so the podcast window contains no unrelated service. Script and transcript content use the shared Jonathan Harris voice plus podcast-specific editorial/retention checks. TTS uses AWS Polly and FFmpeg processing. Output uses the configured podcast, transcript, metadata, artwork and RSS R2 buckets. Key controls include `PODCAST_*`, `POLLY_*`, `AWS_REGION`, FFmpeg timeout settings and OpenRouter editorial/repair/synthesis model settings.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.

The Friday operation window calls readiness first and blocks `/podcast/run` unless the required OpenRouter model, AWS Polly credentials, R2 storage lanes, intro/outro assets, target duration and FFmpeg/FFprobe are available. The operation then polls the podcast status route until the pipeline is terminal. Podcast run de-duplication and status reads use fresh durable job state so polling remains correct across restarts and multi-instance deployments.

## Duration policy

The episode planner targets **50 minutes**. Finished audio may run beyond 60 minutes, but the absolute publication ceiling is **70 minutes**. If the mastered audio would exceed 70 minutes, AIMS automatically preserves the generated work and applies a calculated FFmpeg tempo fit before upload; no manual voice editing is required.
