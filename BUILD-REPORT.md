# Build report

Built on 30 July 2026.

## Completed

- Direct Koyeb Jotform webhook endpoint.
- Fixed production routing for Contact me, Case study and Podcast enquiry.
- Server-side Jotform submission verification.
- Deterministic conversation, contact, message and event identities.
- Atomic D1 persistence with duplicate delivery protection.
- Canonical verified payload storage in D1.
- Redacted R2 integrity receipts with a durable ten-attempt retry queue.
- Koyeb health and readiness endpoints.
- Graceful shutdown for rolling deployment.
- Docker image definition running as the non-root Node user.

## Verification

`npm run check` passes all 11 tests. The tests cover registered form routing, verified-data-only persistence, form mismatch rejection, duplicate delivery, deterministic IDs, Cloudflare account discovery and R2 receipt redaction.

## Deliberate boundary

The three one.com mailbox passwords are not touched by the Jotform process. Email ingestion and sending will be a separate process module so a malformed email cannot disrupt form intake. The secret mapping is recorded in `README.md` for that next slice.
