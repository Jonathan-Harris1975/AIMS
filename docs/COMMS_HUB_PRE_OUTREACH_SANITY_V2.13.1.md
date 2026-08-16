# Comms Hub pre-Outreach sanity close-out — v2.13.1

Date: 2026-08-16

## Scope

This close-out audits every currently supported conversation avenue before Outreach work begins:

- first-party CogniPal website chat;
- one.com `info@` email intake/replies;
- Facebook DMs and comments;
- Instagram DMs and comments;
- YouTube comments (no unsupported YouTube DM lane);
- Jotform Contact, Case Study and Podcast Enquiry orchestration;
- completed Jotform digest/processing/reply;
- email, form and social attachments;
- human handoff/escalation, approvals, idempotency and closed/resolved-state safety;
- Smart Context, Live Content, Conversation Strategy, Conduct/Memory, Prompt Security and Smart Response Intelligence;
- generic policies/saved replies/SLA/retention behaviour across persisted social channel values.

Creative reuse of submitted material for podcast segments, blog articles or newsletter articles remains deliberately outside this layer.

## Gaps closed

1. **Persisted social channel taxonomy** — runtime conversations use `social_dm` and `social_comment`; AI workflow selection, smart context and generic reply delivery now treat those as the supported social family rather than requiring the legacy literal `social` value.
2. **Operational policy family matching** — generic `social` saved replies, workflow conditions, SLA rules, autonomous policies and retention rules now cover both `social_dm` and `social_comment` safely.
3. **Reply-state safety** — email, webchat, social and AI-draft delivery fail closed for closed/quarantined or operationally resolved/snoozed/archived/blocked conversations. A conversation must be deliberately reopened before sending.
4. **Manual outbound language safety** — manual email/social/chat/form reply paths apply the same blocked-language policy as AI drafts.
5. **Email recipient containment** — conversation replies default to the verified conversation email only; additional/arbitrary recipients and CC are blocked unless `COMMS_HUB_EMAIL_EXTERNAL_RECIPIENTS_ENABLED=true` is deliberately enabled.
6. **Jotform source-conversation matching** — a returned form links back to a prior request only through exact form ID plus an active verified email alias. Primary-email coincidence alone is insufficient.
7. **Jotform request lifecycle** — old completed form intent no longer resurrects after the user has moved on; a genuine explicit later request can start a new cycle; retrying one draft keeps the same request ID.
8. **Attachment SSRF boundary** — remote attachment fetches require HTTPS, reject embedded credentials, localhost/private/special-use destinations, DNS resolution to private/special-use addresses, and redirect hops into those networks. Redirect count is bounded.
9. **Social attachment availability/recovery** — social attachments get an immediate secure ingestion attempt even when the generic delayed worker is disabled, while a delayed idempotent recovery action remains available. Recovery skips an attachment already promoted clean.
10. **Migration readiness drift** — the legacy migration manifest is synchronised through `0006_smart_response_forms`, preventing readiness checks from accepting an incomplete schema.
11. **Focused deployment template** — `services/comms-hub/env.template` is restored with safe pre-Outreach defaults, including monitor-only social, no historical email backfill, no automatic form send and delayed-action recovery enabled.
12. **Prompt-security regression fixture** — the security regression now supplies the complex draft route that the current deterministic complexity gate correctly selects, keeping the fail-closed security test meaningful rather than fixture-dependent.

## Acceptance matrix

| Avenue | Intake | Smart analysis | Reply route | Structured form route | Attachment path | Safety state |
| --- | --- | --- | --- | --- | --- | --- |
| Website CogniPal | Signed HMAC + replay/session controls | Yes | First-party transcript | Contact / Case Study / Podcast when justified | N/A in current widget | Pass |
| one.com email | Fresh-mail-only IMAP | Yes | Threaded `info@` reply | Same three forms when justified | Private quarantine → scan → clean | Pass |
| Facebook DM | Zernio webhook/poll | Yes | Meta DM reply | Same three forms when justified | Secure remote ingestion + recovery | Pass |
| Instagram DM | Zernio webhook/poll | Yes | Meta DM reply | Same three forms when justified | Secure remote ingestion + recovery | Pass |
| Facebook comment | Zernio webhook/poll + source-post context | Yes | Public reply / approved moderation | Form only when conversation genuinely requires structured intake | Secure remote ingestion + recovery | Pass |
| Instagram comment | Zernio webhook/poll + source-post context | Yes | Public/private supported Meta paths | As above | Secure remote ingestion + recovery | Pass |
| YouTube comment | Zernio Video family | Yes | Public reply / approved moderation | As above | Secure remote ingestion + recovery | Pass |
| Jotform submission | Provider re-verification | Digest + Smart Response | Verified email response | Already structured | Private quarantine → scan → clean | Pass |

## Safety posture before Outreach

- Autonomous chat replies remain off while Smart Layers are being observed.
- `COMMS_HUB_SOCIAL_MONITOR_ONLY=true` remains the safe state until the outstanding provider action canaries are deliberately completed.
- `COMMS_HUB_FORM_AUTO_SEND_ENABLED=false` remains the safe state while real form-processing drafts are observed.
- `COMMS_HUB_EMAIL_EXTERNAL_RECIPIENTS_ENABLED=false` is the safe default.
- Historical email backfill remains prohibited.
- Prompt-injection, poisoned-evidence, conduct, output leakage, grounded-link, approval and idempotency gates remain mandatory.

## Validation

The final Comms Hub suite passed **158/158** tests after these changes. The focused cross-channel acceptance subset passed **155/155**. Build validation passed the source audit, relative-import audit and production import graph.

Live-provider facts still require live-provider evidence. This code close-out does not falsely convert outstanding Facebook/Instagram/YouTube controlled action canaries into passed provider tests.
