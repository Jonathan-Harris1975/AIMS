# AIMS Comms Hub email fetch resource fix v2.9.7

## Production evidence

The v2.9.6 runtime proved that one.com IMAP configuration, TLS/login, mailbox selection and D1 poll-state claiming were working. The worker claimed the info/INBOX state at last UID 270, read UIDVALIDITY 1743212768 and observed highest UID 297. Koyeb then failed its HTTP health check immediately after `commsHub.emailPoll.fetch.start`, before `fetch.complete` or `emailPoll.failed` could be emitted.

After Koyeb recreated the instance, the same mailbox generation reported highest existing UID 270 and subsequent polls fetched zero messages. This exposed two production weaknesses in the v2.9.6 fetch path.

## Root causes fixed

1. `BufferedSocketReader` appended every incoming TLS chunk with `Buffer.concat([oldBuffer, chunk])`. Large RFC822 literals therefore repeatedly copied the whole accumulated message, creating quadratic copy/GC pressure and potentially starving the HTTP health endpoint.
2. `fetchMessages()` retained both each raw RFC822 Buffer and its parsed representation (including decoded attachment Buffers) for an entire batch of up to 25 messages before persistence. This multiplied peak memory usage.
3. The worker fetched the full configured batch before persisting anything, increasing the blast radius of one large or complex message.
4. The mailbox high watermark came from `UID SEARCH ALL`. The highest *currently visible* UID can move backwards when another mail client or server rule moves/expunges recent messages even though UIDVALIDITY has not changed. That is not a safe mailbox-generation cursor.

## v2.9.7 behaviour

- The socket reader now stores incoming network chunks in a queue and consumes them without repeated whole-buffer concatenation.
- Parsed messages no longer retain the raw RFC822 Buffer after parsing.
- The poll worker fetches and persists one message at a time while keeping the existing configured batch as the maximum number processed per run.
- Successful full batches are scheduled for another drain after one second; partial/empty batches return to the normal poll interval.
- Per-message telemetry now emits `commsHub.emailPoll.messageFetched` and `commsHub.emailPoll.messagePersisted`.
- Mailbox cursor discovery uses IMAP `UIDNEXT - 1` when advertised by the server, with `UID SEARCH ALL` retained only as a compatibility fallback.
- Cursor telemetry includes `uidNext` and `cursorSource`.
- Historical backfill remains disabled and the first-run/UIDVALIDITY safety boundary remains intact.

## Validation

- `node --check` passed for all changed production JavaScript.
- 9 focused source-safety tests passed, including the new bounded-memory and UIDNEXT contracts.
- `scripts/buildCheck.js` passed:
  - 380-module control-character audit
  - 380-module full relative-import audit
  - 309-module production import graph
- The dependency-driven behavioural email test could not run in this source archive because `node_modules` is absent (`pino` is not locally installed). Koyeb's normal build performs dependency installation before runtime.

## Expected next production evidence

For fresh mail after the saved UID, logs should progress through:

1. `commsHub.emailPoll.imapCursor.complete` with `cursorSource: "uidnext"`
2. `commsHub.emailPoll.fetch.start` with `mode: "bounded_one_message_at_a_time"`
3. `commsHub.emailPoll.messageFetched`
4. `commsHub.emailPoll.messagePersisted`
5. `commsHub.emailPoll.fetch.complete`
6. `commsHub.emailPoll.complete`
7. `commsHub.emailPoll.processed`
