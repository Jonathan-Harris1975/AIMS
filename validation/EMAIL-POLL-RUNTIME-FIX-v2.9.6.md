# AIMS Comms Hub email poll runtime fix — v2.9.6

Date: 2026-08-15

## Production faults addressed

1. The boot-time email poll called `void this.runOnce()` without a rejection handler. `runOnce()` records a failure and then rethrows it, so a failed first IMAP attempt could escape as an unhandled rejection during process startup.
2. Successful polls with zero new messages emitted no completion event, making a healthy empty mailbox indistinguishable from a worker that never executed.
3. A D1 `not_due` claim emitted no state detail, hiding stale leases / next-attempt timing after instance replacement.
4. one.com IMAP failures were wrapped as one generic error without retaining the safe provider stage (TLS, greeting, login, EXAMINE, UID SEARCH, UID FETCH, parse).
5. `fetchMessages()` selected the newest UIDs in a bounded batch (`slice(-boundedLimit)`) and then advanced `last_uid` to the newest processed UID. A burst larger than the batch could therefore skip earlier unseen UIDs permanently. It now processes ascending UIDs and takes the oldest bounded batch first.

## Changed files

- `services/comms-hub/workers/emailPollWorker.js`
- `services/comms-hub/clients/oneComMailClient.js`
- `services/comms-hub/repositories/commsOperationsRepository.js`
- `services/comms-hub/routes/index.js`
- `test/comms-hub-email-preflight-safety.test.js`
- `test/comms-hub-email-poll-source-safety.test.js`
- `test/comms-hub-onecom-mail-source-safety.test.js` (new)
- `package.json`
- `package-lock.json`

## New runtime evidence

A healthy deployment should now expose an explicit sequence such as:

- `commsHub.emailPoll.started`
- `commsHub.emailPoll.attempt`
- `commsHub.emailPoll.claimed` or `commsHub.emailPoll.skipped`
- `commsHub.emailPoll.imapCursor.start`
- `commsHub.emailPoll.imapCursor.complete`
- first safe run: `commsHub.emailPoll.baseline`
- later runs: `commsHub.emailPoll.fetch.start`, `commsHub.emailPoll.fetch.complete`, `commsHub.emailPoll.complete`
- when mail is found: `commsHub.emailPoll.processed`
- failures: `commsHub.emailPoll.failed` plus `commsHub.emailPoll.initialRunFailed` or `commsHub.emailPoll.tickFailed`, with a safe provider stage

No password or raw LOGIN command is logged.

## Manual forced diagnostic

The existing protected endpoint now accepts `force: true` in its JSON body:

`POST /comms-hub/email/poll/drain`

Body: `{ "force": true, "limit": 25 }`

This resets only the poll scheduling/lease state for the configured mailbox. It does not enable historical backfill and does not reset `last_uid`.

## Validation performed

- `node --check` passed for all four changed production JavaScript files.
- 9 targeted email-poll tests passed, including the boot-time rejection containment and successful empty poll behaviour.
- `node scripts/buildCheck.js` passed:
  - source control-character audit: 380 modules
  - full source relative-import audit: 380 modules
  - production relative import graph: 309 modules
  - build check passed

The repository does not include `node_modules`. A clean dependency installation was not available in this execution environment, so the complete dependency-driven `npm test` suite was not rerun here.
