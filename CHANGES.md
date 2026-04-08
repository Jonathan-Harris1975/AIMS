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
