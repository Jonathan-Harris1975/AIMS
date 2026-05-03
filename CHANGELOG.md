# Changelog

## 2026-05-03 - SEO/AEO/GEO audit analysis payload and CI hardening

- Fixed the SEO/AEO/GEO async analysis polling response so completed jobs expose the forensic analysis payload from all supported job shapes:
  - `job.analysis`
  - `job.result.analysis`
  - legacy direct `job.result` forensic payloads
- Stored completed forensic analysis both at top level and inside `result.analysis` for compatibility across rolling Koyeb deploys and existing durable-state records.
- Made OpenRouter provider resolution dynamic at request time instead of relying only on import-time env snapshots. This avoids stale diagnostics and CI failures when tests set env vars after earlier imports.
- Added `AIProviderRequestError` naming to OpenRouter HTTP errors while keeping body snippets masked.
- Added duplicate alias skipping so `anthropic46` and `anthropic` do not call the same configured model/key twice.
- Updated audit route tests to match the async `202 Accepted` + polling contract.
