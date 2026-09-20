# Comms Hub notification reliability remediation

**Scope:** AIMS production remediation, September 2026  
**Migration:** `0021_notification_delivery_reliability`

## Database contract

Migration `0021_notification_delivery_reliability` is a forward migration. It does not change the checksum or contents of already-applied historical migrations. It rebuilds the notification table while preserving existing rows and permits every currently emitted notification type:

- `assignment`
- `mention`
- `escalation`
- `sla_warning`
- `sla_breach`
- `failure`
- `system`
- `human_handoff_requested`
- `human_callback`
- `content_quality_review`

The same migration extends contact aliases with `callback_email`, matching the callback-capture path in `humanContactService`. It also rebuilds delayed actions to permit `notification_email` and nullable `conversation_id`, because a system notification need not belong to a conversation.

Notification insertion no longer uses silent SQL conflict behaviour for schema violations. Only an exact repeated notification ID is treated idempotently; a reused ID with different notification content raises `notification_idempotency_conflict`. Unsupported notification types remain observable database failures.
The same contract-hardening pass replaces blanket `INSERT OR IGNORE` behaviour on delayed actions and channel/social outbound idempotency claims with conflict-targeted inserts, so CHECK/foreign-key/shape violations remain visible while expected idempotency conflicts remain safe.

## Durable notification email

`emailRequested: true` is persisted before transport. The notification service schedules a delayed action with the idempotency key `notification-email:<notification-id>`. Migration 0021 backfills equivalent actions for historical notification rows where email was requested but `email_sent_at` is still null. The worker also repairs a missing queue row for `pending` or `retry_pending` notifications on later runs.

State transitions are:

```text
pending -> sending -> sent
             |
             +-> retry_pending -> sending
             |
             +-> reconciliation_required
             |
             +-> quarantined
```

Successful delivery stores `email_sent_at` and the provider message ID. Temporary failures are retried through the existing delayed-action lease/backoff machinery with at most six attempts. Permanent SMTP 5xx rejection is not retried. Delivery-uncertain failures, including connection loss after the SMTP DATA body has been handed to the provider, require reconciliation and are never automatically resent.

A deterministic RFC Message-ID derived from the notification ID provides an additional provider-side idempotency signal. Database state remains the authoritative AIMS duplicate-prevention mechanism.

## Restart and concurrency behaviour

Delayed actions are durable D1 rows. Only one worker can lease a given row at a time. A second worker cannot acquire the same active lease. If the process dies after the notification enters `sending`, a later worker does not assume that no email was sent; it changes the notification to `reconciliation_required` and quarantines the delayed action. If provider delivery succeeds but action completion is replayed, the persisted `sent` state makes execution a no-send duplicate.

## Human handoff and callback

Website live handoff and proactive CogniPal/human-review handoff persist `human_handoff_requested` notifications with critical severity and notification email requested. Supported social human-handoff flows use the same helper. Callback-email capture stores a `callback_email` alias and emits `human_callback`. Notification failures in these paths are no longer converted silently to `null`.

## Operator reconciliation

The authenticated route is:

`POST /comms-hub/notifications/:id/email/reconcile`

It requires `manage_workflows` and accepts:

- `outcome: "sent"`, with optional `providerMessageId`, when provider evidence confirms delivery;
- `outcome: "retry"` only when provider evidence confirms non-delivery;
- `outcome: "quarantined"` when manual handling should remain required.

A retry resets the existing delayed action by its idempotency key. It does not create a parallel queue or a new message identity.

## Verification coverage

`test/comms-hub-notification-delivery.test.js` exercises the real SQLite migration/schema and repository for upgrade preservation/backfill, notification-type enforcement, idempotency, successful delivery, success-state persistence, temporary retry, retry exhaustion, permanent rejection handling at the worker boundary, delivery uncertainty, reconciliation, restart recovery, queue repair, worker lease concurrency, website handoff, CogniPal human review, callback capture and critical workflow escalation.

`test/comms-hub-smtp-classification.test.js` covers provider response classification for permanent SMTP rejection, temporary SMTP failure and delivery-uncertain transport failure.
