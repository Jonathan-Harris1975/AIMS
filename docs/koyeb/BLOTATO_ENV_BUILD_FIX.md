# Koyeb Blotato/state env build unblock

## Confirmed issue

The supplied Koyeb env workbook contained a truncated Blotato template value:

```env
BLOTATO_NEWS_TEMPLATE_ID=/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d662...
```

That is not a valid production value. Use the full template path:

```env
BLOTATO_NEWS_TEMPLATE_ID=/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1
```

## Deployment order

1. Remove the current narrowed Blotato/state env group from Koyeb.
2. Paste `koyeb-env/blotato-state-corrected.env`.
3. Redeploy.
4. If Koyeb still sticks, remove only `BLOTATO_RSS_PREFER_R2=true` and redeploy with `BLOTATO_RSS_PREFER_R2=false` to isolate R2 RSS reading from the social-video path.

## Guardrail added

`npm run build` now validates any configured critical Koyeb env values. It fails loudly if the truncated Blotato template value, malformed booleans/numbers, bad secret interpolation, unsupported channels, or invalid state backend values are present.
