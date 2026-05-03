# SEO/AEO/GEO audit analysis polling fix

## Failure fixed

The live audit report showed the forensic gate failing because the website workflow polled:

`GET /audits/seo-aeo-geo/analysis/:sessionId`

and received HTTP 404 with `Analysis job not found`.

That means the async `/analysis` job had been accepted by one runtime path, but the polling request could not see the job state. On Koyeb this can happen when requests land on a different process/container, or when the R2-backed job state cache is stale.

## Code changes

- The `/analysis` POST route now waits for the queued job state write to flush before returning `202 Accepted`.
- The `/analysis/:sessionId` polling route now refreshes job state from durable state before deciding a job is missing.
- Missing jobs no longer return HTTP 404 during polling. They return a non-terminal JSON state so the website workflow is not killed by a transient cross-instance state miss.
- `jobStore` can now refresh from persisted state using `getPublicJobFresh`.
- `stateFile` can now perform a fresh R2 read using `readJsonStateFresh` and can flush queued remote writes using `flushStateWrites`.

## Expected live behaviour

A successful analysis start should return:

```json
{
  "ok": true,
  "auditType": "seo-aeo-geo",
  "status": "queued",
  "statusUrl": "https://app.jonathan-harris.online/audits/seo-aeo-geo/analysis/<sessionId>"
}
```

Polling should return one of:

```json
{"status":"queued"}
{"status":"running"}
{"status":"completed","analysis":{}}
{"status":"failed","error":{}}
```

It should not return HTTP 404 for a recently accepted analysis job.
