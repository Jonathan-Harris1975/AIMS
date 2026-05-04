# CHANGELOG

## v11 - Audit AI provider resolution hardening

- Fixed the live audit failure shown in Koyeb logs: `AI forensic analysis unavailable: no configured auditForensic providers`.
- Added support for the current Koyeb spreadsheet's generic OpenRouter provider names:
  - `OPENROUTER_ANTHROPIC` / `OPENROUTER_API_KEY_ANTHROPIC`
  - `OPENROUTER_GOOGLE` / `OPENROUTER_API_KEY_GOOGLE`
  - `OPENROUTER_CHATGPT` / `OPENROUTER_API_KEY_CHATGPT`
  - `OPENROUTER_DEEPSEEK` / `OPENROUTER_API_KEY_DEEPSEEK`
  - `OPENROUTER_META` / `OPENROUTER_API_KEY_META`
- Preserved backward compatibility with older spreadsheet aliases using hyphen, dot, and underscore naming.
- Fixed provider resolution so unresolved `{{ secret.* }}` placeholders are skipped when a later real OpenRouter key alias exists.
- Kept unresolved placeholders blocked when no real key is available, preventing pointless OpenRouter 401 calls.
- Added callback-token dual support via `AUDIT_CALLBACK_TOKEN` and `AI_SUITE_AUDIT_CALLBACK_TOKEN`.
- Updated audit/provider diagnostics tests to cover current spreadsheet names, older alias names, and unresolved placeholders.
