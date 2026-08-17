# Comms Hub multi-mailbox email services — AIMS v2.13.5

## Scope

AIMS now treats `info@jonathan-harris.online`, `admin@jonathan-harris.online`, and `newsletter@jonathan-harris.online` as independent one.com mailboxes inside Comms Hub.

- `info` remains the customer-facing Smart/automated email lane.
- `admin` is a separately polled operator mailbox and is manual-reply-only.
- `newsletter` is a separately polled operator mailbox and is manual-reply-only.

Each mailbox has its own IMAP cursor, thread identity, managed address, mailbox metadata, SMTP sender identity, and attachment path. Historical backfill remains disabled.

## Manual-only enforcement

Admin and Newsletter are protected at the backend, not only in the UI. An automated/AI send attempt against either mailbox is rejected with `email_mailbox_manual_only`. The authenticated operator email route supplies the explicit manual-reply flag.

The existing first-response timing policy is preserved. A first operator reply is scheduled through the existing business-hours delayed-action path when the timing rule applies.

## Configuration

Production defaults enable both additional mailboxes:

```env
COMMS_HUB_EMAIL_ADMIN_ENABLED=true
COMMS_HUB_EMAIL_ADMIN_USERNAME=admin@jonathan-harris.online
COMMS_HUB_EMAIL_ADMIN_MAILBOX=INBOX
COMMS_HUB_EMAIL_NEWSLETTER_ENABLED=true
COMMS_HUB_EMAIL_NEWSLETTER_USERNAME=newsletter@jonathan-harris.online
COMMS_HUB_EMAIL_NEWSLETTER_MAILBOX=INBOX
```

Required existing one.com secrets:

```env
ONECOM_ADMIN_PASSWORD=...
ONECOM_NEWSLETTER_PASSWORD=...
```

`info` retains the existing `ONECOM_INFO_PASSWORD`/Comms Hub password compatibility path.

## Unified queue contract

The unified queue now exposes `email_account_key` and `email_mailbox`, and accepts `emailAccountKey=info|admin|newsletter` as a filter. Email thread IDs include the account key to prevent cross-mailbox collisions.

## Validation

Release validation covers independent intake, no-history baselining, manual-only enforcement, correct sender identity, queue filtering, existing Comms Hub security/business-hours behaviour, and the full Comms Hub regression suite.
