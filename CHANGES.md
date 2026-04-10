# Changes

- `package.json`  
  Includes `job-store.test.js` in the default test command so CI exercises the job-state concurrency checks.

- `services/shared/http-client.js`  
  Fixes `fetchWithTimeout()` so request timeouts still fire when an upstream `AbortSignal` is supplied, while still honouring caller-initiated aborts.

- `services/shared/utils/r2-client.js`  
  Corrects canonical bucket-key exports so helper modules receive shared-client alias keys instead of raw bucket names.

- `test/http-client.test.js`  
  Adds a regression test proving timeout enforcement still works with a caller-supplied abort signal.

- `test/r2-client-exports.test.js`  
  Adds a regression test proving the exported canonical R2 bucket identifiers are alias keys.

- `services/oneup/**`
  Adds a new OneUp social scheduler service with seven daily lanes, a weekly quiz route, shared prompt generation, queue guarding, dry-run previews, and weekend RSS-assisted freshness with fallback post generation when feed context is weak or unavailable.

- `routes/index.js` and `server.js`
  Mount the new `/oneup` service and expose it in the server endpoint registry.

- `services/shared/utils/requestSchemas.js` and `services/shared/utils/ai-config.js`
  Add request validation and AI route mapping for OneUp daily and quiz generation flows.

- `env.template`
  Adds the OneUp API, scheduling, and timing environment variables required by the new social scheduler.

- `README.md`
  Documents the new `oneup` service in the repository service overview.

- `test/oneup-social.test.js`
  Adds regression coverage for request schema coercion, daily dry-run generation, quiz dry-run generation, and the updated Tuesday hashtag set.

