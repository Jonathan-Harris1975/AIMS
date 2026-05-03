# Changelog

## SEO + AEO + GEO audit hardening

- Hardened `auditForensic` provider routing so it uses the existing shared OpenRouter env naming already defined in `services/shared/utils/ai-config.js`.
- Added provider metadata for model and key env names so diagnostics can explain missing configuration without leaking secrets.
- Added shared AI provider diagnostics and a specific configuration error when no audit forensic providers are usable.
- Switched the shared AI requester to Node's global `fetch`, matching the repo's Node 20+ runtime contract and avoiding a duplicate transport dependency path.
- Expanded the `auditForensic` fallback chain to Anthropic, Google, ChatGPT, then DeepSeek, using the repo's existing `OPENROUTER_*` variables.
- Updated audit callback authentication to accept either `AUDIT_CALLBACK_TOKEN` or `AI_SUITE_AUDIT_CALLBACK_TOKEN`.
- Rebuilt the SEO/AEO/GEO forensic analysis utility around the supplied full-estate forensic prompt requirements.
- Added strict forensic JSON validation, compatibility aliases for the existing report builder, and a targeted AI repair pass for malformed or incomplete model JSON.
- Added rejection of empty issue ledgers, missing scores, missing implementation sequence, missing coverage appendices, generic remediations, and duplicated issue remediations.
- Added targeted unit tests for callback auth, provider env mapping, and forensic JSON validation.
