# Newsletter reliability investigation — 10 November 2026

## Production evidence

Read-only R2 operation receipts and persisted child jobs show that the initial Tuesday draft was quarantined after four lightweight reviews and a council score of 66. Reality Check discussed Analytics Vidhya's context engineering story but retained the source ID, title and URL of O'Reilly's microservices story. Reviewers repeatedly identified the mismatch. Targeted repairs could change prose but could not change this citation; the bounded repair allowance was exhausted. The recorded `repair-service-unavailable` failure included `AI_TASK_REPAIR_BUDGET_EXHAUSTED`, not proof of a provider outage.

Automatic same-day recovery produced a different approved draft (score 85), passed sender/audience readiness, and recorded one sent, zero failed. The Tuesday window completed at 10:33:50 UTC/London on attempt 3. Attempt 3 reused the successful generation from attempt 2 while completing other content work. It did not regenerate or resend a second newsletter. These records establish SMTP acceptance, not inbox placement or reading.

Artwork failed two bounded visual-QA attempts (text/pseudotext, decorative geometry, generic scene). Existing optional-artwork continuity sent the approved text-only edition. The visual threshold remains unchanged and rejected artwork is not published.

## Repair

Targeted repair now receives the composer's canonical S0..Sn source IDs. Reality Check may select another supplied source ID; code attaches that source's canonical title and URL. Unknown IDs and arbitrary links/titles are rejected before a provider response is accepted. Other story source pairings remain immutable. Revised copy still passes the existing independent quality gates. No model policy, threshold, repair allowance or Headroom setting changes.

## Failure coverage reviewed

| Failure point | Existing measure / verification | Remaining boundary |
| --- | --- | --- |
| Unavailable or malformed RSS | Bounded per-feed retry/timeout; source deduplication and dated 24/72-hour pool; minimum source check before model spend | No invented stories if too few sources exist |
| Malformed model output / provider faults | Structured parsing, bounded provider recovery and failover; separate transport allowances | All providers can still be unavailable |
| Unsupported claims / wrong source | Independent review, quarantine, bounded corrections; this change enables verified Reality Check recitation | Semantic correctness still requires review |
| Repair exhaustion | Fixed allowance prevents runaway cost; same-day operation recovery | An exhausted allowance can still hold an unsafe issue |
| Artwork rejection | Two attempts, sanitised diagnostics, approved text-only edition when artwork is optional | Required-artwork configuration deliberately blocks |
| Storage/restart interruption | Durable R2 job/receipt state and approved editorial checkpoint | Storage outage blocks safe persistence |
| Scheduler / asynchronous child | Terminal job polling; same-day bounded recovery; successful task reuse | Exhausted recovery needs investigation |
| Sender / audience / database | Readiness gate; consent and suppression; provider failures returned explicitly | Empty eligible audience is not a successful send |
| Partial send / crash after SMTP | Atomic D1 recipient claims; sent recipients skipped; definite failures retryable | Uncertain acceptance requires reconciliation to prevent duplicates |
| Weekend edition | Prepared issue validation, London delivery/cutoff windows and maintenance clearance | Outside-window delivery is deliberately deferred |

Validation: 136 newsletter, operation and shared repair regression tests passed; lint passed. Tests include malformed-provider recovery, arbitrary citation rejection, canonical source reattachment, quarantine, storage checkpoints, optional artwork, recipient claims, delivery flow and weekend rules. No extra production generation or delivery was triggered during investigation.
