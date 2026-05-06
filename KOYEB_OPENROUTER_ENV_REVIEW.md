# Koyeb eMedium & OpenRouter Environment Review

Source reviewed: `Keys-updated-transcript-env.xlsx`.

Secrets are masked. Do not paste secret values into logs or reports.

## Recommended Koyeb eMedium baseline

| Action | Variable | Current value | Recommended value | Reason | Risk | Code change required |
|---|---|---:|---:|---|---|---|
| Change | `NODE_ENV` | `Production` | `production` | Node and Express conventions expect lowercase production; safer for libraries checking exact values. | Low | No |
| Add | `NODE_OPTIONS` | Not set | `--max-old-space-size=1536` | Keeps V8 heap below the 2GB Koyeb limit, leaving space for native ffmpeg and buffers. | Low | No |
| Keep | `LOG_LEVEL` | `info` | `info` | Good production default; debug logs stay quiet unless deliberately enabled. | Low | No |
| Change | `INTERNAL_BASE_HOST` | `localhost` | `127.0.0.1` | Avoids IPv6/localhost ambiguity for internal callbacks. | Low | No |
| Keep | `PORT` | `3000` | Koyeb-provided `$PORT` or `3000` fallback | Server already binds `process.env.PORT || 3000` on `0.0.0.0`. | Low | No |
| Add/Keep | `APP_TMP_DIR` | Not in spreadsheet | `/tmp/ai-management-suite` | Centralises temp files on Koyeb's ephemeral disk. | Low | Yes, optional temp-dir support added |
| Keep | `PROCESSING_TIMEOUT_MS` | `210000` | `210000` | Existing global processing timeout is acceptable for trigger/webhook style work. | Low | No |

## AI and OpenRouter controls

| Action | Variable | Current value | Recommended value | Reason | Risk | Code change required |
|---|---|---:|---:|---|---|---|
| Keep | `OPENROUTER_API_KEY` | Secret placeholder | Keep masked secret | One shared OpenRouter key is now supported across role-based and legacy model routes. | Low | Yes, route resolution verified |
| Keep/Add alias | `OPENROUTER_API_BASE` | `https://openrouter.ai/api/v1` | Keep | Current value is valid. | Low | No |
| Add | `OPENROUTER_BASE_URL` | Not set | `https://openrouter.ai/api/v1` | Preferred clear alias; code falls back to `OPENROUTER_API_BASE`. | Low | Yes |
| Add | `OPENROUTER_SITE_URL` | Not set | `https://app.jonathan-harris.online` | Sets OpenRouter attribution header without hard-coding. | Low | Yes |
| Add | `OPENROUTER_APP_NAME` | Not set | `AI Management Suite` | Sets OpenRouter title/app header without hard-coding. | Low | Yes |
| Add | `OPENROUTER_SORT_BY` | Not set | `price` | Price-aware provider routing for cost control. | Low | Yes |
| Add | `OPENROUTER_SERVICE_TIER` | Not set | `auto` | Allows OpenRouter tier control without code edits. | Low | Yes |
| Add | `OPENROUTER_ENABLE_FALLBACKS` | Not set | `true` | Allows OpenRouter provider fallbacks where supported. | Low | Yes |
| Add | `OPENROUTER_REQUIRE_PARAMETERS_FOR_JSON` | Not set | `true` | For JSON-mode tasks, require providers that support the requested parameters. | Low | Yes |
| Add | `AI_USAGE_LOG_ENABLED` | Not set | `true` | Logs model, duration, token counts, and returned cost only when available; no prompt body or secret values. | Low | Yes |
| Add | `AI_MODEL_FAST` | Not set | `google/gemini-2.5-flash-lite` | Cheap/fast model role for summaries, metadata, short titles and simple social output. | Medium | Yes |
| Add | `AI_MODEL_STANDARD` | Not set | `openai/gpt-5-mini` | Default balanced model role for rewrite and normal content tasks. | Medium | Yes |
| Add | `AI_MODEL_HIGH_QUALITY` | Not set | `anthropic/claude-sonnet-4.6` | Higher-quality role for final editorial and complex generation. | Medium | Yes |
| Add | `AI_MODEL_AUDIT` | Not set | `anthropic/claude-sonnet-4.6` | Keeps audit reasoning strong without forcing the expensive model everywhere. | Medium | Yes |
| Add | `AI_MODEL_JSON` | Not set | `openai/gpt-5-mini` | Dedicated structured-output role. | Medium | Yes |
| Add | `AI_MODEL_SUMMARY` | Not set | `google/gemini-2.5-flash-lite` | Low-cost role for summarisation and metadata. | Medium | Yes |
| Add | `AI_MODEL_FALLBACK` | Not set | `deepseek/deepseek-v4-flash` | Cheap fallback role before slower or more expensive fallbacks. | Medium | Yes |
| Add | `AI_MODEL_IMAGE` | Not set | `google/gemini-2.5-flash-image` | Optional role for artwork image generation. | Medium | Yes |
| Change | `AI_MAX_RETRIES` | `5` | `1` | Prevents retry storms on one small instance; app-level model fallback now carries more of the resilience. | Medium | Yes, default changed |
| Keep | `AI_MAX_TOKENS` | `4096` | `4096` | Good general cap; audit has separate higher limit. | Low | No |
| Change | `AI_RETRY_BASE_MS` | `500` | `750` | Slightly calmer retry backoff under load. | Low | Yes, default changed |
| Change | `AI_TEMPERATURE` | `0.85` | `0.65` | Reduces rambling/retries and improves consistency for production generation. | Medium | Yes, default changed |
| Change | `AI_TIMEOUT` | `60000` | `90000` | Gives slower cost-effective models room to complete once, rather than failing and retrying repeatedly. | Medium | Yes, default changed |
| Keep | `AI_TOP_P` | `0.9` | `0.9` | Reasonable general setting. | Low | No |
| Keep | `AUDIT_AI_MAX_RETRIES` | `0` | `0` | Already prevents expensive audit retry storms. | Low | No |
| Keep | `AUDIT_AI_MAX_TOKENS` | `9000` | `9000` | Suitable for forensic audit output. | Low | No |
| Keep | `AUDIT_AI_TIMEOUT_MS` | `240000` | `240000` | Audit calls are allowed to be slow and deliberate. | Low | No |
| Keep | `AUDIT_AI_TEMPERATURE` | `0.15` | `0.15` | Good for deterministic audit reasoning. | Low | No |

## Task concurrency and timeout controls

| Action | Variable | Current value | Recommended value | Reason | Risk | Code change required |
|---|---|---:|---:|---|---|---|
| Change | `TTS_CONCURRENCY` | `3` | `1` | Polly/audio chunk processing should not compete with ffmpeg on 1 vCPU/2GB RAM. | Medium | Yes, default changed |
| Change | `MAX_CHUNK_RETRIES` | `5` | `3` | Keeps stalled TTS/audio work from blocking the worker too long. | Medium | Yes, default changed |
| Keep | `MAX_POLLY_NATURAL_CHUNK_CHARS` | Not visible in reviewed rows, template uses `2800` | `2800` | Conservative for Polly neural chunks and memory. | Low | No |
| Keep | `PODCAST_FFMPEG_TIMEOUT_MS` | `900000` | `900000` | Long enough for full audio work; now enforced in merge/edit/master processors. | Low | Yes |
| Add | `MERGE_BATCH_SIZE` | Not set | `2` | Keeps recursive merge batches small and memory-light. | Low | Yes |
| Add | `MERGE_CLEANUP_DELAY_MS` | Not set | `120000` | Allows callers to use the local path briefly, then cleans temp files. | Low | Yes |
| Add | `MERGE_DOWNLOAD_TIMEOUT_MS` | Not set | `30000` | Separates chunk download timeout from AI timeout. | Low | Yes |
| Add | `PODCAST_MERGE_TMP_DIR` | Not set | blank or `/tmp/ai-management-suite/podcast_merge` | Optional override for Koyeb temp storage. | Low | Yes |
| Add | `PODCAST_EDIT_TMP_DIR` | Not set | blank or `/tmp/ai-management-suite/tts_editing` | Optional override for Koyeb temp storage. | Low | Yes |
| Add | `PODCAST_MASTER_TMP_DIR` | Not set | blank or `/tmp/ai-management-suite/podcast_master` | Optional override for Koyeb temp storage. | Low | Yes |
| Keep | `MAX_RSS_FEEDS_PER_RUN` | `5` | `5` | Fine when paired with bounded fetch concurrency. | Low | No |
| Keep | `MAX_URL_FEEDS_PER_RUN` | `1` | `1` | Conservative already. | Low | No |
| Add | `FEED_FETCH_CONCURRENCY` | Not set | `2` | Bounds RSS/network fetching instead of running all selected feeds at once. | Low | Yes |
| Keep | `FEED_FETCH_TIMEOUT_MS` | `15000` | `15000` | Good per-feed timeout. | Low | No |
| Change | `OUTREACH_BATCH_SIZE` | `40` | `20` | Reduces pressure on enrichment, validation and memory on eMedium. | Medium | No |
| Add | `ZEROBOUNCE_BATCH_SIZE` | Not set | `25` | Makes ZeroBounce batch size env-driven and smaller by default. | Low | Yes |
| Add | `ZEROBOUNCE_TIMEOUT_MS` | Not set | `30000` | Makes ZeroBounce timeout env-driven. | Low | Yes |
| Add | `ZEROBOUNCE_DELAY_MS` | Not set | `600` | Avoids coupling ZeroBounce pacing to Hunter delay. | Low | Yes |
| Keep | `SERP_RESULT_LIMIT` | `30` | `30` | Reasonable cap; reduce only if outreach runs are still too slow. | Low | No |
| Change | `MAX_DOMAINS_PER_KEYWORD` | `30` | `10` | Better fit for low-cost single-instance outreach runs. | Medium | No |

## Remove / needs confirmation

| Action | Variable | Current value | Recommendation | Reason |
|---|---|---:|---|---|
| Remove only after live verification | Legacy provider-specific OpenRouter API key vars such as `OPENROUTER_API_KEY_GOOGLE`, `OPENROUTER_API_KEY_CHATGPT`, `OPENROUTER_API_KEY_DEEPSEEK`, `OPENROUTER_API_KEY_META` | Not all present in spreadsheet | Prefer one shared `OPENROUTER_API_KEY`, but keep aliases for backwards compatibility until Koyeb env is confirmed clean. | Avoids breaking old deployments. |
| Needs confirmation | Any unused third-party keys | Secret/masked | Keep unless the corresponding route/service is retired. | The repo still contains outreach, OneUp, audit, podcast, RSS and blog paths. |

## Manual Koyeb dashboard settings

- Instance: eMedium, one web service process only.
- Start command: `npm start`.
- Health check path: `/health`.
- Port: use Koyeb's injected `$PORT`; keep `PORT=3000` only as a local fallback.
- Do not run duplicate cron/worker copies of the same long-running podcast, RSS, audit or outreach job on the same service instance.
