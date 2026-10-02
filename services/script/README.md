# Podcast script service

**Live route prefix:** `/script`

Creates the written episode components used by the podcast pipeline: intro, main sections, synthesis/composition, outro, final editorial pass, transcript and metadata.

## HTTP contract

- `GET /script/health`
- `POST /script/intro`
- `POST /script/main`
- `POST /script/outro`
- `POST /script/compose`
- `POST /script/orchestrate`

The only production script router is `services/script/routes/index.js`; the central
`routes/index.js` registry mounts it at `/script`. Schema validation and shared
request deduplication are mandatory for every generation route. The deterministic
source contract can be run with
`node --test test/script-router-source-contract.test.js`.

## Behaviour

All major generation stages use the shared tone setter plus podcast-specific prompt contracts. The service applies source grounding, sentence/length controls, metadata/keyword generation and final editorial review before downstream TTS. Outputs are written to the configured raw-text, transcript, metadata and metasystem storage paths.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.

## Long-form source coverage and section recovery

Friday PM explicitly requests 60 minutes. The existing duration planner also
supports 30, 45 and 50 minutes for other callers; this repair preserves those
profiles. `wordBudget.js` centralises the established 2.3 words/second planning
rate and unchanged 105 words/minute validation floor. The 60-minute profile has
3,415 main seconds and a main target of 7,855 words, plus intro and outro.

Ingestion uses the existing seven-day news period, excludes future dates, takes
the richest available RSS content field, and expands summaries below 300 words
through their own article links. Retrieval has a 15-second end-to-end timeout,
2 MiB limit, three redirects (HTTP or static HTML refresh), HTTP/HTTPS only,
public DNS/IP checks with pinned connections, and no embedded URL credentials.
Scripts are never executed. Article/main text is preferred and common navigation,
scripts and boilerplate are removed. One unavailable article retains its RSS
summary; it does not abort ingestion. Matching links, titles, bodies and strong
near-duplicate title/body pairs are consolidated.

The conservative coverage gate requires at least three stories containing at
least 120 words each and enough evidence for a maximum three-to-one discussion
to source-word ratio. This is an explicit operational heuristic, not a factual
accuracy guarantee. Source-integrity and editorial gates still apply. There is
no new external news source or automatic expansion beyond seven days. Thin
coverage returns `PODCAST_INSUFFICIENT_SOURCE`, HTTP-equivalent 422, coverage
figures and an earliest retry time one hour later. Friday recovery observes that
cooldown rather than spending all three attempts immediately.

The main is planned in approximately 750-word sections with budgets proportional
to evidence. Evidence blocks are bounded at 800 words and balanced across sections.
Generation requires 94–110% of each section's target and a complete ending; output
reported as truncated or content-filtered is rejected. Short complete prose can
be continued. Truncated prose is regenerated for that section. Each section has
at most three attempts, including resumed attempts. Provider retries retain the
shared rate-limit/backoff controls and are limited to one per provider request.

Validated sections and attempts are checkpointed using the existing private
state backend, under a hash of session/date/duration/editorial identity. The
source snapshot remains fixed on recovery. The final main is assembled directly;
there is no single unverified synthesis response that can replace all its text.
Editorial polishing runs on blocks bounded at 5,000 characters and rejects cuts exceeding 2% or
truncated edits. Council repairs also reject cuts exceeding 2%. Final structure,
word count, source-integrity and cadence gates precede all raw-text uploads and
TTS. Exhausted section repairs return `PODCAST_SECTION_EXHAUSTED` and are not
retried automatically for the same operation window.

The Friday-specific recovery revision permits one bounded recovery of an old
exhausted Friday receipt after deployment, without resetting other operation
windows. Successfully completed tasks retain the existing duplicate guards.

Run regression coverage with:
`node --test test/podcast-longform-repair.test.js`.
The test providers are deterministic fixtures; they do not establish real model
quality, article accessibility on Koyeb, audio duration or production publication.
Production acceptance still requires an authenticated full episode run and
inspection of its transcript, audio, RSS publication and stage logs.

The retired `PODCAST_SYNTHESIS_*` settings no longer control main generation.
Existing editorial token/timeout/reasoning settings continue to apply per block.
