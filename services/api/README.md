# API composition module

`services/api/index.js` exports an internal Express router that groups podcast, script, TTS and artwork routers.

The production server does not mount this aggregate router. `routes/index.js` mounts the live service routers individually so each service has an explicit top-level prefix and route-registry entry.

## Exported composition

- `/podcast` → podcast router
- `/script` → script router
- `/tts` → TTS router
- `/artwork` → artwork router

Use the production prefixes documented in the repository root README for live HTTP calls.
