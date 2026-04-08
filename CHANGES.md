# Fresh check patch set

Changed files:

- `services/outreach/services/batchService.js`
  - Fixes production fallback to `services/outreach/data/batch-progress.json` when durable R2 progress is missing or failing.
  - Production now fails fast unless `ALLOW_EPHEMERAL_STATE=true` explicitly opts into local state loss.

- `services/outreach/utils/r2ProgressStore.js`
  - Fixes catch-all error handling that treated any R2 read failure as “progress file missing”.
  - Only genuine missing-object conditions initialise a new progress cursor; other errors now propagate.

- `services/script/utils/episodeCounter.js`
  - Fixes catch-all error handling that reset the podcast episode counter to `1` on any R2 read failure.
  - Only genuine missing-object conditions initialise a new counter; other errors now propagate.

- `test/durable-state.test.js`
  - Adds regression coverage for production durable-state behaviour.
  - Verifies no silent local fallback in production and no silent reset on non-missing R2 failures.
