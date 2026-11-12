# Comms Hub housekeeping

This is the operating contract for automated Communications Hub housekeeping.

## Cadence

| Cadence | Owner | Work |
|---|---|---|
| Daily | AIMS in-process worker | Retention-policy health, expiry/janitor work and provider-health pruning |
| Sunday 08:00 Europe/London | MAST | Unresolved-quarantine report; no automatic unresolved-item deletion |
| Day 1, 04:00 Europe/London | MAST | Full monthly cycle after the 03:00 one.com Trash/Junk cleanup |

MAST calls `POST /comms-hub/maintenance/run` with the exact confirmation `run-comms-hub-monthly-housekeeping`. The D1 run ledger gives each period one idempotent window.

## Monthly controls

1. Verify at least one active retention policy. Migration `0023_housekeeping` supplies a 365-day archive-only baseline; a zero-policy state raises a critical operator notification and fails the stage.
2. Expire overdue approvals and form requests, reject linked pending drafts, remove expired webhook nonces and prune only old safe terminal records.
3. Recreate the isolated D1 restore database, restore and verify the latest complete backup, retain the newest configured backup runs, and remove expired restore-validation objects.
4. Report quarantine counts and aged items. Only a reviewer action may replay, resolve or dismiss an unresolved item.
5. Reconcile private R2 attachment records and objects. Missing referenced objects are reported, old unreferenced objects may be removed after the grace period, and only terminal infected/failed quarantine uploads expire automatically.
6. Prune old provider-health samples while retaining the latest provider/adapter sample. Old audit events are first written as an immutable checksummed private-R2 segment; the final chain hash remains in D1 as the next-event checkpoint.
7. Monitor archive, webhook reconciliation, backup, retention, month-end archive and housekeeping through `/comms-hub/workers/health`.
8. Move only persisted old messages from closed/resolved Info conversations to the one.com server-advertised Archive folder. Admin and Newsletter are not message-archived by AIMS.

## Operator routes

- `GET /comms-hub/maintenance/status`
- `POST /comms-hub/maintenance/run`
- `POST /comms-hub/maintenance/quarantine-review`
- `POST /comms-hub/quarantine/:id/replay`
- `POST /comms-hub/quarantine/:id/resolve`
- `POST /comms-hub/quarantine/:id/dismiss`

All are AIMS-authenticated and permission-gated. A monthly response is successful only when all seven reported stages have `ok=true`.

## Quarantine tidy-up

The authorised weekly automation runs on Monday at 08:00 Europe/London (including BST).
It calls `POST /comms-hub/maintenance/quarantine-tidy`, first with `{"dryRun":true}`
and then with `{"dryRun":false}`. This endpoint never invokes replay handlers or sends communications.
It moves failures whose original delayed action is complete/cancelled into history. It also
 dismisses orphaned failures older than seven days only when both their original delayed action
and their conversation reference are absent. Existing open conversations, failed/quarantined work,
scheduled retries, leased actions and uncertain deliveries remain for review. Each decision is
rechecked in the transaction and recorded in the quarantine attempt history. Each pass handles
at most 500 candidates and reports cleared, retained, concurrently changed and purged counts.

Only terminal history beyond `COMMS_HUB_HOUSEKEEPING_COMPLETED_RECORD_DAYS` (production: 180 days)
is purged, and records whose source can still execute are excluded. Clearing the active queue
therefore preserves recent failure details and the audit trail. The existing Sunday report is unchanged.

Manual resolve/dismiss requires a reason. Cancelling the corresponding queued action and recording
the decision are atomic; a leased action or uncertain delivery cannot be dismissed. Replay uses
an atomic claim and never resets a running/scheduled/completed/missing action. The UI shows the
current replay eligibility, Active/History filters, redacted technical details and a previewed tidy action.

Invalid evidence references receive one draft-only repair using the same route and approved evidence.
A second invalid draft is quarantined immediately, avoiding eight full pipeline retries; validation
still rejects unknown references, ungrounded URLs and unsafe output.

Interrupted delayed-action replays are recovered after 30 minutes only if their live source is no
longer leased and no delivery reconciliation is outstanding. Completed sources move to history;
other idle sources return to review with an interrupted-attempt record. Confirming a notification
as delivered updates both its notification and delayed-action state atomically, allowing closure.
