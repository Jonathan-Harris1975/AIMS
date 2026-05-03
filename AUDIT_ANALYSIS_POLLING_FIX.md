# SEO/AEO/GEO audit analysis polling fix

## Root cause

The website audit workflow polls `GET /audits/seo-aeo-geo/analysis/:sessionId` and treats HTTP `202` as an in-progress analysis job. The previous AI Management Suite patch returned HTTP `200` for queued/running job states. That made the website workflow inspect the body immediately, find no `analysis` payload yet, and mark the run as `completed but no analysis payload`.

## Fix

The polling endpoint now follows a strict status contract:

- `202` for `queued`, `running`, or transient durable-state propagation.
- `200` only when the job is completed and includes a forensic analysis payload.
- `409` when the job failed or completed without a valid analysis payload.

The completed response exposes the validated forensic JSON at top-level `analysis`, nested `result.analysis`, and nested `job.analysis` for compatibility with current and previous website workflow callers.

## Deployment note

Deploy the AI Management Suite change first, then rerun `/audits/seo-aeo-geo/run`. No website change is required for this specific failure if the website workflow is already using async polling.
