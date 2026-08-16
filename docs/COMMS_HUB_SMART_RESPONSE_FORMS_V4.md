# Comms Hub Smart Response + Jotform Orchestration V4

## Purpose

This layer sits above Smart Context, Smart Conduct, Live Content Awareness and the mandatory prompt-security boundary. It decides whether a conversation can be answered directly, needs one focused clarification, needs Jonathan's review, or genuinely benefits from one of the three approved Jotforms.

It does not grant send, provider, moderation or tool authority. Existing approval, capability and idempotency gates remain authoritative.

## Approved structured-intake forms

AIMS recognises only the existing allow-listed Jotforms:

| Key | Purpose | Form ID | Default URL |
|---|---|---:|---|
| `contact` | Structured contact/proposal/support detail | `260281179574362` | `https://form.jotform.com/260281179574362` |
| `case_study` | Case-study / experience contribution | `262063136008044` | `https://form.jotform.com/262063136008044` |
| `podcast_enquiry` | Podcast guest/contribution enquiry | `262097861889073` | `https://form.jotform.com/262097861889073` |

The URLs may be overridden by the matching environment variables, but the form IDs/workflows remain allow-listed.

## Smart Response Intelligence

For each conversation AIMS derives deterministic response state including:

- answerability;
- confidence band;
- whether one clarification is required;
- whether human review is required;
- low-risk autonomous eligibility;
- next conversational move;
- selected Jotform, if any.

Normal questions remain conversational. A form is not used as an escape hatch for a question that AIMS can answer normally.

Typical structured-intake decisions:

- podcast participation / guest / contribution → podcast enquiry form;
- case-study / implementation-story contribution → case-study form;
- genuinely structured proposal, brief, speaking/media/consulting detail or explicit form request → contact form.

Security review, repeated abusive conduct and human-handoff requirements take precedence over form routing.

## Form-link delivery rules

- The exact allow-listed URL is injected dynamically into the draft prompt.
- A selected form URL is grounded by the internal AIMS form registry and does not require unrelated external AI Search evidence.
- The URL is still subject to output security validation.
- If the person has explicitly asked for no links, AIMS asks permission before exposing the form URL.
- AIMS does not imply that form submission guarantees acceptance, publication, a podcast appearance, collaboration or any other outcome.
- Once an active request for that form has been sent in the conversation, AIMS does not nag the user by sending it repeatedly.

A form request becomes durable only after the channel reply containing the form has actually been delivered.

## Durable request lifecycle

Migration `0006_smart_response_forms` adds `comms_hub_form_requests` with the lifecycle:

`sent → submitted → processed → replied`

Expired/cancelled states are also supported.

Where a source conversation already has a verified email identity, a returned Jotform can be matched conservatively using exact form ID plus exact verified email. AIMS deliberately does not guess cross-channel identity when that proof is absent.

## Verified form digest

The existing Jotform intake remains authoritative:

1. webhook identifiers are received;
2. AIMS re-fetches and verifies the submission through Jotform;
3. the verified submission is persisted in D1;
4. attachments enter the existing private quarantine → malware scan → clean-promotion path;
5. Smart Form Processing registers a deterministic digest.

The digest separates:

- routing/form identity;
- verified contact details for internal reply delivery;
- substantive form answers;
- attachment count/review state;
- missing reply-critical information.

Direct name/email/phone values are not placed into the model-facing form-processing payload. Labels and answer text remain untrusted data and pass through the prompt-security sanitiser.

## Processing and reply

`COMMS_HUB_FORM_SMART_PROCESSING_ENABLED=true` enables post-intake analysis. The background form-processing step runs only after attachment ingestion has been attempted.

The model is explicitly told:

- Jotform already owns the immediate receipt acknowledgement;
- do not send a duplicate acknowledgement;
- produce a substantive processed reply;
- identify only genuinely missing information;
- never invent the content of an attachment;
- do not promise acceptance/publication/booking;
- do not start podcast-segment, blog-article or newsletter-article creation.

Processed form replies use the existing one.com `info@jonathan-harris.online` mail transport and persistent channel idempotency. They are recorded as outbound messages on the form conversation.

## Send policy

`COMMS_HUB_FORM_AUTO_SEND_ENABLED=false` is the safe default.

With that setting, the pipeline reaches a draft-ready or pending-approval state but does not send autonomously. An authorised workflow can explicitly process/send a low-risk draft, and drafts that require approval remain blocked until their existing approval gate is satisfied.

Even when auto-send is explicitly enabled, AIMS requires all of the following:

- a generated draft exists;
- the draft does not require approval;
- Smart Response Intelligence marks the response autonomously eligible;
- no attachment review remains outstanding;
- normal output-security, language, grounding and idempotency gates pass.

## Operator/API endpoints

- `GET /comms-hub/forms/:conversationId/status`
- `POST /comms-hub/forms/:conversationId/process`

`POST .../process` accepts `{ "autoSend": true }` only as an explicit attempt. It does not bypass approval or eligibility controls.

## Configuration

- `COMMS_HUB_SMART_RESPONSE_ENABLED=true`
- `COMMS_HUB_SMART_RESPONSE_MIN_CONFIDENCE=0.86`
- `COMMS_HUB_FORM_ORCHESTRATION_ENABLED=true`
- `COMMS_HUB_FORM_SMART_PROCESSING_ENABLED=true`
- `COMMS_HUB_FORM_AUTO_SEND_ENABLED=false`
- `COMMS_HUB_FORM_REQUEST_EXPIRY_HOURS=336`
- `COMMS_HUB_JOTFORM_CONTACT_URL=https://form.jotform.com/260281179574362`
- `COMMS_HUB_JOTFORM_CASE_STUDY_URL=https://form.jotform.com/262063136008044`
- `COMMS_HUB_JOTFORM_PODCAST_URL=https://form.jotform.com/262097861889073`

## Deliberately out of scope

Turning a user's submitted information into any of the following is a separate downstream process and must not be started by this layer:

- podcast segment or episode content;
- blog article;
- newsletter article.

The form-processing layer finishes at structured intake, digest, assessment/draft and the appropriate reply to the user.
