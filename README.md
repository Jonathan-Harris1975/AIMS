# AIMS Comms Hub

Production Jotform intake service for Koyeb. It reuses the website's verified-submission normalisation approach and implements the first complete Comms Hub vertical slice without generated scaffolding or placeholder handlers.

## Implemented flow

1. `POST /v1/intake/jotform` accepts a Jotform webhook.
2. The form and submission IDs are extracted from the webhook envelope.
3. Only the three production forms are accepted.
4. The submission is fetched from Jotform using `JOTFORM_API_KEY`; webhook field values are not trusted.
5. A deterministic conversation ID, contact ID, message ID and event ID are created.
6. Contact, conversation, first message and intake event are committed to D1 in one batch transaction.
7. Duplicate webhook delivery is accepted without creating duplicate records.
8. A redacted receipt is queued and uploaded to the `comms-hub` R2 bucket. The receipt contains no name, email address, phone number, answers or message body.

## Production forms

| Purpose | Jotform ID | Workflow |
| --- | --- | --- |
| Contact me | `260281179574362` | `contact_intake` |
| Case study | `262063136008044` | `case_study_intake` |
| Podcast enquiry | `262097861889073` | `podcast_enquiry_intake` |

## Koyeb environment

Required:

```text
D1_UUID
D1_API_KEY
JOTFORM_API_KEY
```

Optional:

```text
CLOUDFLARE_ACCOUNT_ID
R2_BUCKET=comms-hub
PORT=8000
ARCHIVE_POLL_MS=60000
```

`D1_API_KEY` must be a Cloudflare API token with D1 read/write and R2 object write access. When `CLOUDFLARE_ACCOUNT_ID` is omitted, the service discovers the account by locating `D1_UUID` among the token's accessible accounts.

The one.com password secrets are deliberately not loaded by this intake process. They belong to the next email transport slice and should be mapped to valid environment names rather than exposed in source:

```text
INFO_EMAIL_PASSWORD       <- Koyeb secret info-Jonathan-harris
NEWSLETTER_EMAIL_PASSWORD <- Koyeb secret newsletter-Jonathan-harris
ADMIN_EMAIL_PASSWORD      <- Koyeb secret admin-Jonathan-harris
```

## Koyeb deployment

Deploy the repository or this directory with the included Dockerfile. Configure:

```text
Port: 8000
Health check: /health
Readiness check: /ready
```

Set each Jotform Webhooks integration URL to:

```text
https://<your-koyeb-service-host>/v1/intake/jotform
```

Jotform's webhook timeout is 30 seconds. The request path performs only Jotform verification and one D1 batch. R2 upload runs from the durable retry queue after the webhook has been accepted.

## R2 privacy boundary

The supplied `r2.dev` URL is public. Private correspondence is therefore stored only in D1. R2 receives a redacted integrity receipt with a SHA-256 hash of the canonical D1 payload. Do not place raw submissions, message bodies, email addresses or attachments under the public development URL.

## Local verification

```bash
npm test
npm run check
```
