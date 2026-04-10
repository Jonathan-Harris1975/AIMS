# CHANGES

## deployment-check.js
- Fixes two confirmed deployment-gate defects.
- Loads `.env` before validating, so the CLI reflects the same configuration source used by the rest of the repository.
- Adds the existing production durable-state requirement to the deployment check, preventing false-green deploy approvals when `scripts/startupCheck.js` would still fail.
- Safe because it only tightens a preflight script and does not alter any request/response contracts, runtime routes, storage keys, or service behaviour.

## test/deployment-check.test.js
- Adds regression coverage for the two confirmed defects.
- Verifies the CLI now honours `.env` input.
- Verifies production validation fails when durable state is not configured.
- Safe because it only locks in the intended preflight contract.
