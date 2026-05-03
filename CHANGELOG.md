# Changelog

## SEO/AEO/GEO audit forensic gate hardening

- Fixed the `/analysis/:sessionId` polling contract so pending analysis jobs return HTTP `202`, not HTTP `200` without a payload.
- Ensured completed polling responses expose the forensic JSON at `analysis`, `result.analysis`, and `job.analysis`.
- Added `409` diagnostics for failed or completed-without-analysis jobs so failures are explicit rather than misread as successful empty responses.
- Restored async analysis job handling, durable job-state refresh, Koyeb OpenRouter env-name support, and audit-specific AI timeout/retry defaults from prior patches.
- Updated route test polling expectations to accept `202` while the job is still running and require `200` only for completed analysis.
