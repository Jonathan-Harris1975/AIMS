# Comms Hub email automation scope

## Current boundary

AIMS Communications Hub manages only `info@jonathan-harris.online`.

`admin@jonathan-harris.online` and `newsletter@jonathan-harris.online` are intentionally outside the message-automation boundary. AIMS must not poll, classify, draft, reply, follow up, retain, month-end archive, or surface those inboxes in the Unified Inbox.

The sole exception is cleanup-only maintenance. When explicitly enabled, AIMS may authenticate to all three one.com accounts and permanently empty only the folders that the IMAP server advertises with the `\\Trash` and `\\Junk`/`\\Spam` special-use flags. It does not inspect or process message content, and it fails closed rather than guessing folder names.

## Enforcement

The boundary is enforced in several layers rather than relying on deployment flags alone:

- `config.emailAccounts` contains only `info`; Admin and Newsletter are listed as explicit exclusions.
- Email intake and send operations reject the excluded account keys with `email_mailbox_automation_excluded`.
- AI analysis and workflow evaluation reject legacy excluded-mailbox conversations.
- Automatic follow-up, delayed-action, retention and month-end archive selection skip excluded mailbox conversations.
- Unified Inbox queries hide legacy Admin/Newsletter conversations and the AIMS-UI specialist queues for those inboxes have been removed.
- Production and example configuration pin the old Admin/Newsletter enable switches to `false`; the runtime code does not honour a stale `true` value.
- Cleanup is exposed through a separate Admin-only maintenance service and requires an exact permanent-deletion confirmation value.
- MAST invokes that maintenance service once on the first day of each month; no Admin/Newsletter poller is created.

## Managed email configuration

```env
COMMS_HUB_EMAIL_ENABLED=true
COMMS_HUB_EMAIL_CLEANUP_ENABLED=true
COMMS_HUB_EMAIL_ADMIN_ENABLED=false
COMMS_HUB_EMAIL_NEWSLETTER_ENABLED=false
COMMS_HUB_ONECOM_ACCOUNT_KEY=info
COMMS_HUB_ONECOM_EMAIL_ADDRESS=info@jonathan-harris.online
COMMS_HUB_ONECOM_USERNAME=info@jonathan-harris.online
ONECOM_INFO_PASSWORD=...
ONECOM_ADMIN_PASSWORD=...
ONECOM_NEWSLETTER_PASSWORD=...
```

Admin and Newsletter mailbox passwords are required only when monthly cleanup is enabled. Their independent operational ownership and message processing remain outside Comms Hub.

## Legacy-data handling

Migration `0012_excluded_email_automation_scope` cancels queued delayed actions and follow-ups for Admin/Newsletter conversations left by earlier versions. Existing conversation data is preserved; it is simply kept outside active AIMS automation.
