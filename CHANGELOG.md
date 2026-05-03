# Changelog

## 2026-05-03 - SEO/AEO/GEO analysis job visibility fix

- Fixed `/audits/seo-aeo-geo/analysis/:sessionId` returning HTTP 404 after async analysis hand-off.
- Added fresh durable-state reads for job polling so Koyeb cross-instance requests can see jobs written by another process.
- Added remote write flushing after `/analysis` job creation before returning `202 Accepted`.
- Changed transient missing analysis job polling from HTTP 404 to a JSON queued/not-found-yet state to avoid failed-gate reports caused by polling transport errors.
- Added documentation explaining the failure mode and expected live behaviour.
