# Comms Hub business-hours and human-contact layer — v2.13.2

## Acceptance rules

### Email initial response

- Applies to the first AIMS outbound reply on an email conversation.
- Target is deterministically selected at 2 or 3 **calendar days** after the first inbound message.
- A Saturday/Sunday target rolls forward to the next Monday.
- The selected delivery time is within 09:00-17:00 `Europe/London` (17:00 is the closed boundary).
- Subsequent replies are not artificially delayed by this initial-response rule.
- If an overdue delayed action is claimed outside the business window, the worker defers it to the next business opening rather than sending late.

### Processed Jotform reply

- The same 2-3 calendar-day + weekday + 09:00-17:00 rule applies to the first substantive AIMS response after a verified Jotform submission.
- Jotform's immediate receipt acknowledgement remains owned by Jotform and is not duplicated by AIMS.
- AI drafts and explicit/manual processed-form responses both enter the same delayed-action gate.

### CogniPal human hand-off

- Live hand-off is available only Monday-Friday, 09:00-17:00 UK time.
- Outside that window the chat remains in automation mode and offers an optional callback-email path.
- Authenticated operator attempts to set `takeover_requested` or `human` outside the window are rejected.
- A visitor-provided callback email is recorded only with explicit/ contextual consent and is stored as an unverified, conversation-scoped `callback_email` alias.
- The callback alias does not silently establish cross-channel identity and cannot satisfy verified-email matching used for returned Jotforms.

### Social DMs

- Facebook and Instagram DMs use the same live-handoff availability calculation.
- In-hours: AIMS may tell the user Jonathan is available for hand-off and also offer the email callback alternative.
- Out-of-hours: AIMS must not imply Jonathan is online; it offers the optional email callback route.
- `COMMS_HUB_SOCIAL_MONITOR_ONLY=true` still wins. No provider DM is sent while the social canary is monitoring-only.
- YouTube has no private DM capability in this integration.

### Wake behaviour

The public website's signed request to the first-party CogniPal AIMS endpoint is itself the cold-start/wake request for Koyeb. The optional `COMMS_HUB_WAKE_*` relay is supplemental signalling after intake. It is best-effort and cannot turn an already accepted visitor message into a failure.

## Persistence / migration

`0007_business_hours_and_handoff.sql` rebuilds `comms_hub_delayed_actions` with the additional action types required by this layer:

- `reply_draft`
- `email_reply`
- `form_reply`

Existing delayed rows and idempotency keys are copied intact before the old table is replaced.

## Safe production defaults

```env
COMMS_HUB_BUSINESS_TIMEZONE=Europe/London
COMMS_HUB_BUSINESS_START_HOUR=9
COMMS_HUB_BUSINESS_END_HOUR=17
COMMS_HUB_EMAIL_INITIAL_REPLY_DELAY_ENABLED=true
COMMS_HUB_FORM_REPLY_DELAY_ENABLED=true
COMMS_HUB_REPLY_DELAY_MIN_DAYS=2
COMMS_HUB_REPLY_DELAY_MAX_DAYS=3
COMMS_HUB_HUMAN_HANDOFF_BUSINESS_HOURS_ONLY=true
COMMS_HUB_CALLBACK_EMAIL_CAPTURE_ENABLED=true
COMMS_HUB_DELAYED_ACTION_WORKER_ENABLED=true
```

The loader rejects `COMMS_HUB_HUMAN_HANDOFF_BUSINESS_HOURS_ONLY=false`; live hand-off is intentionally fail-closed. Legacy `COMMS_HUB_REPLY_DELAY_*_BUSINESS_DAYS` names are read only as compatibility fallbacks if the new `*_DAYS` variables are absent.
