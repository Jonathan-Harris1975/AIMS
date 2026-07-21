# Newsletter fix — empty AI completion from openai/gpt-5-mini

## Root cause
`AI_MODEL_STANDARD=openai/gpt-5-mini` is a reasoning model. Under load it was
spending its entire `max_tokens` budget on internal reasoning tokens before
writing any visible output, so OpenRouter returned HTTP 200 with
`message.content: ""` (while `usage.completion_tokens` still showed spend,
e.g. 640 tokens for nothing visible).

`ai-service.js` treated any 200 response as a success and returned the empty
string straight through — it never retried or failed over to the next
provider (highQuality / fallback). `compose.js` then failed to parse the
empty string as JSON, logged `newsletter.compose.lead_parse_failed`, and the
route threw a 500. Because `/newsletter/generate` never produced a stored
issue, the scheduled `/newsletter/send` call 30 minutes later correctly (by
its own design) found nothing to send and returned 404 — that 404 is a
downstream symptom, not a separate bug.

## Fix (2 files)
- `services/shared/utils/ai-service.js`
  - Sends `reasoning: { effort: "low" }` to OpenRouter by default (configurable
    via `OPENROUTER_REASONING_EFFORT`, set to `none`/`off` to disable) so
    reasoning models leave headroom for actual output.
  - If a provider still returns empty `message.content`, this is now thrown
    as a retryable error instead of returned as a "successful" empty string —
    so `resilientRequest` retries and then fails over to the next provider in
    the route chain (`highQuality`, `fallback`, etc.) exactly like any other
    provider failure.
- `services/newsletter/engine/compose.js`
  - Raised `max_tokens` headroom for the three newsletter compose calls
    (700→1400, 900→1700, 200→500) so there's room left for visible content
    even after reasoning tokens.

## Deploy
Drop these two files into the matching paths in the repo and redeploy the
Koyeb service. No env var changes are required (optional:
`OPENROUTER_REASONING_EFFORT` if you want a different default than `low`).
