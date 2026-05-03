# Audit AI env fix

The SEO + AEO + GEO forensic audit now reads the exact OpenRouter variable names used on Koyeb:

- `OPENROUTER_ANTHROPIC_4_6` + `OPENROUTER_API_KEY_ANTHROPIC_4_6`
- `OPENROUTER_GOOGLE_2_5_flashlite` + `OPENROUTER_API_KEY_GOOGLE_2_5_flashlite`
- `OPENROUTER_CHATGPT_mini5_` + `OPENROUTER_API_KEY_CHATGPT_mini5`
- `OPENROUTER_DEEPSEEK_v4_pro` + `OPENROUTER_API_KEY_DEEPSEEK_v4_pro`
- `OPENROUTER_DEEPSEEK_v4_flash` + `OPENROUTER_API_KEY_DEEPSEEK_v4_flash`
- `OPENROUTER_META` + `OPENROUTER_API_KEY_META`

The trailing underscore in `OPENROUTER_CHATGPT_mini5_` is intentionally supported because that is the current Koyeb env name.

The audit route also supports these audit-specific overrides:

- `AUDIT_AI_MAX_TOKENS`
- `AUDIT_AI_TIMEOUT_MS`
- `AUDIT_AI_MAX_RETRIES`
- `AUDIT_AI_RETRY_BASE_MS`
- `AUDIT_AI_TEMPERATURE`
- `AUDIT_AI_TOP_P`

Recommended production values:

```env
AUDIT_AI_MAX_TOKENS=9000
AUDIT_AI_TIMEOUT_MS=240000
AUDIT_AI_MAX_RETRIES=0
AUDIT_AI_RETRY_BASE_MS=500
AUDIT_AI_TEMPERATURE=0.15
AUDIT_AI_TOP_P=0.95
```

Failed async jobs now return JSON state from `GET /audits/seo-aeo-geo/analysis/:sessionId` instead of producing repeated HTTP 500 polling responses.
