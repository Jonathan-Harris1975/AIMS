# Audit AI Gate Fix v12

## Fixed
- Aligned OpenRouter provider resolution with the current Koyeb spreadsheet: one shared `OPENROUTER_API_KEY` is now used for every configured OpenRouter model.
- Kept support for existing model env names such as `OPENROUTER_ANTHROPIC_4_6`, `OPENROUTER_GOOGLE_2_5_flashlite`, `OPENROUTER_CHATGPT_mini5_`, `OPENROUTER_DEEPSEEK_v4_pro`, `OPENROUTER_DEEPSEEK_v4_flash`, and `OPENROUTER_META`.
- Kept legacy provider-specific API key names as optional fallbacks only.
- Added callback token dispatch from Koyeb into the GitHub workflow inputs so the website workflow does not need to own the callback secret for Koyeb-triggered runs.
- Redacted token-like workflow inputs from the AI suite dispatch response.
- Preserved async `/audits/seo-aeo-geo/analysis` polling behaviour and durable job-state handling.

## Why
The latest Koyeb log showed the workflow dispatch and callback configuration were working, but the forensic analysis failed because no `auditForensic` provider was considered configured. The spreadsheet now has one shared OpenRouter key, while the resolver was still leaning too heavily on provider-specific keys.
