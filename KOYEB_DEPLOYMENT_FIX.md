# Koyeb deployment fix

This patch removes the two common causes of the service appearing stuck during Koyeb deployment:

1. **Build/network stalls** are bounded with npm and apt fetch timeouts/retries. The Dockerfile and Nixpacks fallback both use the public npm registry and `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`.
2. **Runtime startup hard-fail** is removed when durable state env is missing. If R2 durable state is configured, the app still uses it. If Koyeb misses those variables, the app logs a warning and boots with local state rather than failing before `/health` is available.

## Required Koyeb service settings

- Builder: Dockerfile
- Dockerfile path: `Dockerfile`
- Exposed port: `3000`
- Start command: leave blank, or `npm start`

## Durable state

Preferred production settings:

```text
STATE_BACKEND=auto
R2_ENDPOINT=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_META_SYSTEM=metasystem
R2_PUBLIC_BASE_URL_META_SYSTEM=...
RSS_INIT_ON_BOOT=false
```

`STATE_BACKEND=r2` or `REQUIRE_DURABLE_STATE=true` makes missing durable state a hard failure again. Leave them unset while stabilising Koyeb deployment.

## Local verification commands

```bash
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run build
npm run deploy:smoke
node --check server.js
```
