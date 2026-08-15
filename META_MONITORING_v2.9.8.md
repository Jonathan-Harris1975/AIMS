# AIMS Comms Hub Meta monitoring v2.9.8

This release opens the Facebook/Instagram observation phase without opening outbound social mutations.

## Production canary flags

```env
COMMS_HUB_ZERNIO_META_ENABLED=true
COMMS_HUB_ZERNIO_VIDEO_ENABLED=false
COMMS_HUB_ZERNIO_POLL_ENABLED=true
COMMS_HUB_SOCIAL_MONITOR_ONLY=true
COMMS_HUB_ZERNIO_POLL_MS=120000
```

The existing secret-backed values remain required for the enabled Meta family:

- `ZERNIO_META_API_KEY`
- `ZERNIO_META_WEBHOOK_SECRET`
- `COMMS_HUB_PUBLIC_BASE_URL`
- `COMMS_HUB_D1_PROXY_URL`
- `COMMS_HUB_D1_PROXY_TOKEN`

No secret values are stored in this repository.

## Monitoring behaviour

When `COMMS_HUB_SOCIAL_MONITOR_ONLY=true`:

- Facebook and Instagram polling remains enabled.
- Signed Meta webhook intake remains enabled.
- DMs/comments can be persisted and deduplicated in the Comms Hub data plane.
- The social status route reports the worker/family monitoring state without exposing credentials.
- Every outbound social action is rejected before repository/provider mutation, including reply, read-state, archive/status, hide, unhide, delete and moderation approval/action paths.

## Expected runtime evidence

Startup:

- `commsHub.socialPoll.started`
- `commsHub.runtime.started` with `socialMonitoring.monitorOnly=true`, family `meta`, and platforms `facebook`, `instagram`

Polling:

- `commsHub.socialPoll.attempt`
- `commsHub.socialPoll.claimed`
- `commsHub.socialPoll.conversations.listed` or `commsHub.socialPoll.commentPosts.listed`
- `commsHub.socialPoll.messages.page` / `commsHub.socialPoll.comments.page` when provider objects exist
- `commsHub.socialPoll.complete`
- `commsHub.socialPoll.runComplete`

Webhook intake:

- `commsHub.socialIntake.accepted`

## Validation

- `node --check` passed for all modified production JavaScript files.
- Meta monitoring + Phase 2 tests: 25 passed, 0 failed.
- Full source/static build check: 380 source modules, 309 production graph modules, passed.
- Phase 4 hardening tests passed.
- One pre-existing Phase 3 AI strict-JSON fixture fails identically in the unmodified v2.9.7 baseline; it is unrelated to this Meta patch.
