# AIMS Comms Hub

Comms Hub is service 15 inside the existing AIMS process. It is mounted at `/comms-hub`; it does not own a second server, package, Docker image or process lifecycle.

## Implemented scope

### Phase 1: verified Jotform intake

`POST /comms-hub/intake/jotform` accepts only these forms:

| Form | Jotform ID | Workflow |
|---|---:|---|
| Contact me | 260281179574362 | `contact_intake` |
| Case study | 262063136008044 | `case_study_intake` |
| Podcast enquiry | 262097861889073 | `podcast_enquiry_intake` |

Every submission is re-fetched through the Jotform API. The returned form and submission identifiers must match before the contact, conversation, message, attachment references and intake event are persisted.

### Phase 2: Zernio social inbox

Zernio remains the connected-channel owner, while AIMS owns ingestion, persistence, actions, polling and operational state.

The two Zernio API keys are deliberately isolated:

| Credential family | API key | Platforms used by Comms Hub | Webhook path |
|---|---|---|---|
| Meta | `ZERNIO_META_API_KEY` | Facebook and Instagram DMs/comments | `/comms-hub/intake/zernio/meta` |
| Video | `ZERNIO_VIDEO_API_KEY` | YouTube comments | `/comms-hub/intake/zernio/video` |

There is no legacy-key or cross-family fallback. Meta events signed with the Video secret, YouTube events sent to the Meta endpoint, and attempts to call a platform with the wrong API key are rejected.

Implemented Phase 2 capabilities:

- raw-body HMAC-SHA256 webhook verification;
- stable event-ID deduplication for at-least-once delivery;
- Facebook and Instagram DM ingestion and replies;
- Facebook and Instagram comment ingestion, public replies, private replies, hide, unhide and delete actions;
- YouTube comment ingestion, replies, deletion and moderation status actions;
- message lifecycle handling for sent, edited, deleted, delivered and read events where the platform supplies them;
- safe handling when lifecycle events arrive before the original message;
- cursor-based polling fallback with independent Meta and Video leases;
- provider/account/thread identities, outbound action idempotency and audit records in D1;
- separate webhook registration and secret rotation for each credential family;
- authenticated operational status, polling and action routes.

## D1 data plane

Phase 1 can use Cloudflare's authenticated D1 REST API for the three low-volume forms. Phase 2 social traffic is not considered ready until `COMMS_HUB_D1_PROXY_URL` and `COMMS_HUB_D1_PROXY_TOKEN` point to the supplied Cloudflare Worker in `workers/comms-hub-data-plane`.

The Worker binds D1 directly and permits only authenticated parameterised runtime `SELECT`, `INSERT`, `UPDATE` and `DELETE` statements. It rejects DDL, SQL stacking, oversized bodies and excessive batch/parameter sizes. Migrations deliberately bypass the Worker and use the administrative Cloudflare D1 API.

## R2 boundary

A distributed D1 lease queue writes only redacted integrity receipts to the public `comms-hub` R2 bucket. Names, email addresses, telephone numbers, form answers, social message bodies, file URLs and uploaded files are not written to the public `r2.dev` endpoint.

A private bucket or controlled authenticated object service is required before private message archives or attachments are introduced.

## Environment contract

Base service secrets and storage:

- `D1_UUID`
- `D1_API_KEY`
- `JOTFORM_API_KEY`
- existing R2 endpoint/access secrets
- `R2_BUCKET_COMMS_HUB=comms-hub`
- `R2_PUBLIC_BASE_URL_COMMS_HUB`

Phase 2 runtime data plane:

- `COMMS_HUB_PUBLIC_BASE_URL`
- `COMMS_HUB_D1_PROXY_URL`
- `COMMS_HUB_D1_PROXY_TOKEN`

Meta family:

- `ZERNIO_META_API_KEY`
- `ZERNIO_META_WEBHOOK_SECRET`
- `COMMS_HUB_ZERNIO_META_ENABLED=true`

Video family:

- `ZERNIO_VIDEO_API_KEY`
- `ZERNIO_VIDEO_WEBHOOK_SECRET`
- `COMMS_HUB_ZERNIO_VIDEO_ENABLED=true`

Each family can be enabled independently. Enabling one does not require or activate the other.

Webhook acceptance budget:

- `COMMS_HUB_ZERNIO_ACK_TIMEOUT_MS=4000`
- Values above 4500 ms are rejected so AIMS answers within Zernio's five-second acknowledgement window. A timeout returns a retryable 503; deterministic event IDs make the later delivery safe.

## Deployment order

1. Deploy `workers/comms-hub-data-plane` with the production D1 binding and a strong Worker secret.
2. Configure the AIMS/Koyeb secrets and keep `COMMS_HUB_ENABLED=false`.
3. Keep both social family switches false during the first deployment.
4. Run `npm ci`.
5. Run `npm run comms:migrate:status`.
6. Run `npm run comms:migrate` to apply `0001_comms_hub` and `0002_zernio_social` through the Cloudflare administrative API.
7. Run `npm test` and `npm run build`.
8. Set `COMMS_HUB_ENABLED=true` and deploy.
9. Verify `/readyz`, `/comms-hub/health` and authenticated `/comms-hub/diagnostics`.
10. Enable Meta, redeploy, then call `POST /comms-hub/social/webhooks/meta/reconcile`.
11. Test one Facebook DM, one Instagram DM and one Meta comment action.
12. Enable Video, redeploy, then call `POST /comms-hub/social/webhooks/video/reconcile`.
13. Test one YouTube comment reply and one moderation action.

Webhook reconciliation always reapplies the configured secret because the Zernio webhook listing does not expose its current secret.

Outbound actions use persistent idempotency records. If a provider call times out or AIMS cannot prove whether the side effect completed, the action enters `reconciliation_required`; the same key is not resent automatically. Verify Zernio before issuing a deliberate new action.

## Routes

Public exact-path routes:

- `GET /comms-hub/health`
- `POST /comms-hub/intake/jotform`
- `POST /comms-hub/intake/zernio/meta`
- `POST /comms-hub/intake/zernio/video`

AIMS bearer-authenticated routes:

- `GET /comms-hub/diagnostics`
- `GET /comms-hub/conversations/:conversationId`
- `GET /comms-hub/social/conversations`
- `POST /comms-hub/social/conversations/:conversationId/actions/:action`
- `GET /comms-hub/social/status`
- `POST /comms-hub/social/poll/drain`
- `POST /comms-hub/social/poll/kick`
- `POST /comms-hub/social/webhooks/:family/reconcile`
- `GET /comms-hub/archive/status`
- `POST /comms-hub/archive/drain`

Outbound social actions require an `Idempotency-Key` header. A completed identical action returns its stored result. Processing or uncertain actions are never resent automatically; a failed request requires a new key after correction.

## Deliberate boundaries

- one.com remains the email host; IMAP/SMTP ingestion and sending are not part of Phase 2.
- TikTok remains on the Video API key but is not a Comms Hub conversation channel because Zernio does not expose TikTok DMs/comments through this implemented slice.
- AI classification, drafting, approval and autonomous reply policies are later phases.
- HIVE operator screens are not included yet; current actions are API-first.
