# AIMS Comms Hub

Comms Hub is service 15 inside the existing AIMS process. It is mounted at `/comms-hub`; it does not own a second server, package, Docker image or process lifecycle.

## Implemented first slice

`POST /comms-hub/intake/jotform` accepts only these forms:

| Form | Jotform ID | Workflow |
|---|---:|---|
| Contact me | 260281179574362 | `contact_intake` |
| Case study | 262063136008044 | `case_study_intake` |
| Podcast enquiry | 262097861889073 | `podcast_enquiry_intake` |

The public webhook is accepted by the central AIMS authentication middleware only for that exact method and path. Every event is then re-fetched from the Jotform API and the returned form/submission identifiers must match before anything is written.

The verified submission is persisted to D1 as a contact, conversation, inbound message, attachment references and an idempotent intake event. A distributed D1 lease queue writes a redacted integrity receipt to the `comms-hub` R2 bucket. Because the supplied `r2.dev` bucket is public, names, email addresses, telephone numbers, answers, message bodies, file URLs and uploaded files are never written to R2.

## Operational constraint

This Jotform-only slice uses Cloudflare's authenticated D1 REST query endpoint because AIMS runs on Koyeb rather than inside a Cloudflare Worker. Keep this transport limited to the three low-volume forms. Before adding one.com mailbox ingestion or Zernio social event volume, place D1 behind a constrained Cloudflare Worker API or another purpose-built data-plane adapter. The repository and service layers are separated so that transport can be replaced without rewriting conversation logic.

The supplied `r2.dev` address is a public development endpoint. The archive worker therefore writes redacted integrity receipts only. A private bucket or controlled custom domain should be used before any non-redacted archive is introduced.

## Deployment order

1. Configure `D1_UUID`, `D1_API_KEY`, `JOTFORM_API_KEY`, the existing R2 credentials and the Comms Hub bucket values.
2. Keep `COMMS_HUB_ENABLED=false`.
3. Run `npm run comms:migrate:status`.
4. Run `npm run comms:migrate`.
5. Set `COMMS_HUB_ENABLED=true` and redeploy AIMS.
6. Verify `/readyz`, `/comms-hub/health` and authenticated `/comms-hub/diagnostics`.
7. Point each Jotform webhook at `https://<AIMS_HOST>/comms-hub/intake/jotform`.

Migrations are explicit and immutable. Runtime startup never creates or alters D1 tables.

## Routes

- `GET /comms-hub/health` public configuration health.
- `POST /comms-hub/intake/jotform` public exact-path webhook with API re-verification.
- `GET /comms-hub/diagnostics` AIMS bearer token required.
- `GET /comms-hub/conversations/:conversationId` AIMS bearer token required.
- `GET /comms-hub/archive/status` AIMS bearer token required.
- `POST /comms-hub/archive/drain` AIMS bearer token required.

## Deliberate boundaries

Zernio remains the configuration owner for Facebook, Instagram and YouTube DMs/comments. one.com remains the email host. Their ingestion adapters are later Comms Hub slices and are not pretended into existence here. The three password variables are reserved in the env templates but are not loaded by this Jotform service.
