# Changes Included in production-fixes.zip

- `services/cloudflare-purge/routes/index.js`  
  Fixes an unauthenticated cache-purge endpoint by requiring a shared secret, failing closed in production, and removing upstream error detail leakage from client responses.

- `services/cloudflare-purge/utils/purgeCloudflareCache.js`  
  Removes the implicit `purge_everything` fallback and enforces explicit purge modes. Simplifies auth handling to Cloudflare bearer-token flow only.

- `services/shared/utils/requestSchemas.js`  
  Tightens Cloudflare purge request validation so callers must choose exactly one purge mode.

- `services/shared/utils/stateFile.js`  
  Adds a production guard that blocks local ephemeral state unless explicitly overridden with `ALLOW_EPHEMERAL_STATE=true`.

- `scripts/startupCheck.js`  
  Adds startup validation for production-safe state configuration and Cloudflare purge secret configuration.

- `env.template`  
  Documents missing environment variables required for the Cloudflare purge service and production-safe state behaviour.

- `test/smoke.test.js`  
  Adds regression coverage for Cloudflare purge validation/auth and the production state backend guard.
