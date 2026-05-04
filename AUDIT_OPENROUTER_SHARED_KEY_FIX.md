# Audit OpenRouter shared key fix

The Koyeb spreadsheet now uses one OpenRouter API key for all OpenRouter-backed models:

```env
OPENROUTER_API_KEY={{ secret.OPENROUTER_API_KEY}}
```

The audit provider resolver now checks that shared key first for every text provider, while still accepting older provider-specific key names as optional fallbacks.

Current spreadsheet model variables supported:

```env
OPENROUTER_ANTHROPIC_4_6=anthropic/claude-sonnet-4.6
OPENROUTER_GOOGLE_2_5_flashlite=google/gemini-2.5-flash-lite
OPENROUTER_CHATGPT_mini5_=openai/gpt-5-mini
OPENROUTER_DEEPSEEK_v4_pro=deepseek/deepseek-v4-pro
OPENROUTER_DEEPSEEK_v4_flash=deepseek/deepseek-v4-flash
OPENROUTER_META=meta-llama/llama-4-scout
```

The website workflow no longer needs to own the callback token for Koyeb-triggered runs. The AI Management Suite dispatches it as the masked `callback_token` workflow input and the website workflow masks it before use.
