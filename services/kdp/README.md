# KDP service

The KDP service is being added to AIMS for two workflows:

- `KDP_publishing`: automated Kindle ebook preparation, submission and status verification.
- `KDP_audit`: monthly listing review and policy-bounded keyword, description and pricing updates.

This initial slice establishes the TextBee OTP ingress used by the KDP login flow. The webhook is received by HIVE-UI, which verifies the TextBee signature and forwards the event to AIMS through the existing AIMS bearer-authenticated API. The KDP publishing workflow will register a short-lived OTP challenge with `beginKdpOtpChallenge`; the webhook broker only delivers a code while that challenge is active.

## Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/kdp/status` | Readiness summary without returning secrets or SMS content |
| POST | `/kdp/otp/textbee` | Internal, bearer-authenticated event handoff from HIVE-UI |

The public TextBee callback is hosted by HIVE-UI at:

`https://hive.jonathan-harris.online/webhooks/textbee/kdp-otp`

Configure TextBee to send only `MESSAGE_RECEIVED` events and use a signing secret of at least 20 characters. Configure that same signing secret as the HIVE-UI `TEXTBEE_WEBHOOK_SECRET`. Configure HIVE-UI `AIMS_ADMIN_TOKEN` with the AIMS `AIMS_API_KEY` value. HIVE-UI verifies the TextBee HMAC over raw request bytes before forwarding the event to this bearer-authenticated AIMS route.

Koyeb service secrets/environment:

- `KDP_USERNAME`
- `KDP_PASSWORD`
- `KDP_OTP_ALLOWED_SENDERS` — comma-separated sender values observed for Amazon OTP messages in TextBee's delivery log. OTP messages are ignored until the sender is allow-listed.
- `KDP_OTP_CHALLENGE_TIMEOUT_MS` — optional, defaults to 180000 and is bounded to 30–300 seconds.

OTP text and codes are never logged or persisted by this ingress. The current broker is process-local and supports one active challenge, so KDP write jobs must be serialized and the AIMS service must run a single replica until the broker is moved to shared state.  
**TODO (migration path):** Move the broker to shared state (e.g., Redis/Upstash) before enabling multi-replica deployments. Add a guardrail (e.g., replica count/check or explicit feature flag) to prevent multi-replica rollouts while the broker remains process-local.

## Current implementation boundary

This PR does not yet automate KDP login, publishing, monthly audits or listing updates. It provides the AIMS service registration, the signed TextBee callback path through HIVE-UI, and the single-use OTP handoff primitive those workflows will use. Publishing and audit actions remain absent until their workflow and R2/D1 integrations are implemented.
