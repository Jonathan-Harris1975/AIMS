# Monthly audit repair completion

Content Master and Website report jobs remain running in `awaiting-remediation` after RAMS accepts their exact report key. Every fresh job-status request reads the authenticated RAMS `/remediation/{content|website}/{runId}` ledger. This survives AIMS restarts. Network failures leave completion unverified; they cannot turn a running repair into a successful audit.

A job completes only when RAMS reports no mandatory manual findings and all repair batches have scoped regression tests, required exact-head workflow checks, a native merged commit and verified current production deployment. Website temporary source evidence is retained until that point. Incomplete synthesis, disabled dispatch and unresolved work fail explicitly.

The trusted `Audit remediation handoff` workflow uses existing Autonomy R2 credentials and the target repository Kilo trigger. RAMS coordinates work; Kilo pushes a bounded `fix/rams-audit-*` branch; native branch automation publishes the PR and owns its existing admission and merge gates. The shared R2 repository writer prevents unrelated CI repair from starting concurrently. Its reservation is never automatically released after an uncertain provider acknowledgement.

Required regression tests use `node:test` in the exact `test/rams-audit-*.test.js` path declared by the immutable plan. Trusted admission checks changed paths and this test file before permitting a managed audit PR. Existing premium model policy and Headroom remain independent of repair completion.

Operational acceptance must include a real audit repair passing through the external writer and production verification. Unit tests and a successful workflow preflight alone do not certify that acceptance.
