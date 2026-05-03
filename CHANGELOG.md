# Changelog

## SEO + AEO + GEO audit hardening v6

- Matched the audit AI provider resolver to the exact Koyeb OpenRouter env var names supplied in production.
- Added explicit support for the current `OPENROUTER_CHATGPT_mini5_` model variable with trailing underscore.
- Converted `/audits/seo-aeo-geo/analysis` into a fast async acceptance endpoint.
- Added polling via `GET /audits/seo-aeo-geo/analysis/:sessionId`.
- Returned failed AI analysis jobs as JSON job state instead of HTTP 500 polling failures.
- Added audit-specific AI timeout, token, retry, temperature, and top-p overrides.
- Masked secret-looking values and OpenRouter response snippets in diagnostics.
- Stopped retrying non-retryable OpenRouter 400/401/403/404 responses.
