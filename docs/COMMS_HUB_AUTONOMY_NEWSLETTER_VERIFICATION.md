# Comms Hub autonomy and newsletter verification

This change is a source repair and verification pass. It does not certify the deployed service. Apply migration `0025_autonomy_newsletter_reliability` through the existing migration runner, obtain green CI on the resulting commit, and verify the deployed versions before production acceptance.

## Attachment delivery

Jotform's intake digest initially holds attachments for review. Processing refreshes that summary from every inbound reference joined to its current object record, including missing object records. A safe record requires the reference to be `stored`, a `clean` scan for its SHA-256, scanner/timestamp evidence, a private bucket and a promoted `attachments/` key. Missing, quarantined, infected, failed, deleted or unreadable state fails closed.

The same authoritative query runs immediately before unapproved form-draft dispatch, including delayed dispatch. Scope-matched human approval remains the reviewed manual path. An existing eligible draft held for attachments can resume after clean promotion without generating another draft.

The existing email provider adapter retains its durable outbound idempotency/reconciliation handling. The attachment tables expose no versioned transaction spanning an external provider send. The query protects changes observed before dispatch; it cannot retract an email after a later quarantine event. Validate concurrent lifecycle changes in staging before accepting P1. Tests do not establish distributed exactly-once delivery.

Autonomous draft dispatch also checks current AI/autonomous enablement and current human ownership, including delayed drafts. Disabling automation or assigning a person after scheduling holds the draft for review; manually requested replies remain available through their existing permission and safety gates.

## Continuous worker watch

Workflow: `.github/workflows/comms-hub-worker-watch.yml`, scheduled at minutes 7 and 37 UTC, independently of deployment. Manual dispatch is supported on `main`.

The current workflow collects the authenticated health response inside Koyeb using `KOYEB_TOKEN` and `KOYEB_SERVICE`; the suite bearer remains in the runtime. The watcher derives its target and expected inventory from `config/production.defaults.env`. Verify those flags against effective runtime configuration before acceptance. Existing Actions secrets `OPS_ALERT_WEBHOOK_URL` and `OPS_ALERT_WEBHOOK_TOKEN` connect the existing independent HIVE operations event abstraction; no new notification provider is introduced.

The watcher fails on unsuccessful HTTP, stale/degraded health, malformed or stale timestamps, empty/missing inventory, absent expected workers, timeout or network failure. CLI installation and runtime collection each have two-minute step limits within the eight-minute job limit. After checkout succeeds, the incident handler runs even if installation/collection fails; a failed or skipped probe becomes `health_probe_failed` and cannot reuse a partial health file. The original failed step still fails the workflow. Malformed nested health objects, timestamps, duplicate enabled identities and boolean numeric values fail closed instead of bypassing incident handling. Cancelled jobs are not claimed as completed monitoring checks.

Incident state persists in the `comms-worker-watch-state` Actions artifact for 90 days. Later runs restore only state from this workflow on `main`. A single ongoing incident sends one accepted failure event. Failed alert attempts remain unnotified and can retry. Recovery emits one bounded signal; failed recovery delivery does not suppress a new incident. Lost/corrupt prior state fails the job rather than resetting incident identity and flooding alerts. A failed artifact upload remains an operational blocker and must be reconciled before resetting state.

The state records check, first detection and accepted-notification times; the workflow records job start. The nominal scheduled-occurrence timestamp is unavailable from this event and remains null. A 30-minute cron is configured cadence, not a latency guarantee. GitHub documents that scheduled jobs can be delayed or dropped: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule. Measure stopped-worker detection and destination delivery in staging; do not infer latency from cron syntax.

## Reply policy

The owner retained the documented 2–3 **calendar-day** first-reply delay on 3 October 2026. Weekend target dates roll forward to weekdays; delivery stays within 09:00–17:00 Europe/London. Tests cover the March and October daylight-saving weekends. No delay setting changed.

## Autonomy metrics

`GET /comms-hub/metrics` returns `metrics.autonomyOutcomes`, grouped by bounded channel, outcome and reason. Each conversation contributes one current row to the cohort defined by its first recorded decision in the requested period. Repeated decisions/restarts do not add rows. A later successful autonomous dispatch replaces its held state; a sent state cannot be downgraded by a later decision. This is a current conversation split for the selected cohort, not counts of individual messages or historical decision events. Conversations still queued/eligible with neither recorded hold nor successful dispatch are outside this denominator.

Auto-sent is recorded after successful provider dispatch and durable draft marking. A queued/scheduled reply is not sent. Retrying an already-sent draft repairs a missing outcome using the persisted autonomous marker without sending again. Governance no longer records a scheduled reply as a completed autonomous send.

Primary hold-reason precedence is automation disabled, safety/conduct, attachment review, approval, missing information, low confidence. Governance also records actual policy/approval/security/rate-limit denials; `rate_limited` is a separate bounded reason. IDs and message/contact data are stored only as internal relational keys, never metric labels.

`COMMS_HUB_AUTONOMOUS_REPLIES_ENABLED` parsing, missing-environment validation, exported configuration and health reporting now share the `aiEnabled` fallback. Explicit false is preserved. Existing parser semantics for empty/malformed values and case remain unchanged.

## Newsletter architecture and delivery

Public website `/newsletter/` embeds Jotform `262733359026055`. Jotform submits to `/comms-hub/intake/jotform`, which re-fetches the authoritative submission through the Jotform API and verifies consent. `processNewsletterJotformSignup` uses D1 audience storage and the dedicated one.com manual newsletter account. It does not add that account to Comms Hub inbound automation.

The direct `/newsletter/subscribe` API remains suite-authenticated and requires explicit boolean consent. Publication is restricted to the implemented `ai-edge` audience. The public site uses Jotform, not this direct API. The existing global rate limiter remains in place. Hosted-form CAPTCHA, validation, submit UX, webhook settings and provider retry behaviour still require live Jotform verification.

The authoritative active audience requires active subscriber and publication subscription, `verified_at`, and no email-hash suppression. New signup remains pending until confirmation. Normalisation is trim/lowercase. Concurrent inserts reference the persisted subscriber ID rather than an independently generated losing candidate. Duplicate active signup does not reset consent or status. Existing unused confirmation links are retained; tokens are cryptographically random, hashed at rest and valid for 48 hours.

`newsletter_confirmation_deliveries` provides a durable per-address/publication SMTP claim. Concurrent requests cannot both send. Safe pre-acceptance transient failures permit up to six attempts; permanent failures do not retry. A sending record after a crash, an uncertain SMTP timeout, or provider acceptance followed by failed local receipt persistence blocks blind replay and requires reconciliation. The SMTP Message-ID is stable, but this does not make SMTP exactly-once. Confirmation is synchronous in the current design; there is no separate confirmation queue. A retry depends on a subsequent request/verified webhook retry and must be checked against actual Jotform behaviour.

Before retrying an uncertain record, inspect the provider/inbox outcome using authorised operational tooling. Preserve the row and audit evidence. Do not reset a `sending` or `reconciliation_required` record on a timer or merely because an HTTP request failed. Automated provider reconciliation is not established by the local tests; this remains a production acceptance criterion.

The confirmation service returns the persisted subscriber ID internally so the verified Jotform path can associate its confirmation audit event correctly. Public subscription responses continue to exclude this ID. A webhook retry repairs a failed post-send audit write from the durable SMTP receipt without sending another confirmation; the conditional audit insert is limited to the submission that recorded the original consent request. Final active audience membership still requires confirmation.

Optional delivery of today's issue is best effort after confirmation. A failure in that optional step does not turn a successfully confirmed subscription into an HTTP error or claim the issue was delivered.

Confirmation links use the configured trusted HTTPS origin, not request Host/return URLs. Only exact GET/HEAD token navigation bypasses suite bearer authentication. Tokens still undergo expiry, suppression and state validation. Successful confirmation updates state transactionally with in-transaction suppression/token checks. Repeated clicks are idempotent and do not trigger a second immediate issue delivery. Confirmation after suppression does not reactivate the subscriber. Token navigation responses prohibit caching/referrer propagation; request and rate-limit logs redact token-bearing paths.

## Newsletter operational signals

`metrics.newsletterConfirmations` contains period-filtered D1 delivery-state counts and consent-requested/confirmed/withdrawn event counts. These distinguish sending, SMTP accepted, failed and reconciliation-required outcomes from consent confirmation.

`metrics.newsletterRequestSignals` contains fixed request-level counters: accepted pending, duplicate, validation rejected, configuration failure, provider failure, provider unknown and suppressed. These use the existing professional-excellence state-file mechanism. They are cumulative for that state file, not filtered by the D1 date range, and are not cross-instance durable totals unless that storage is shared. Retries count as requests; consent transition counters remain separate. Neither signal contains addresses, tokens or arbitrary provider errors.

## Deployment and acceptance gaps

Required effective runtime values include `COMMS_HUB_ENABLED`, D1/account/proxy configuration, `JOTFORM_API_KEY`, `COMMS_HUB_PUBLIC_BASE_URL`, `ONECOM_NEWSLETTER_PASSWORD`, the configured newsletter address and SMTP host/port/timeout. Environment examples/defaults describe intended configuration only; inspect actual runtime secret presence and effective values without disclosure.

Local tests use SQLite and controlled provider adapters. They verify code behaviour, not a Jotform provider receipt, real mailbox arrival, deployed D1 state or the actual public form UX. Authorised runtime/provider access, a staging environment and an explicitly authorised controlled test inbox are required before P7 PASS.

Current-SHA CI and deployed integration evidence observed on 8 October 2026 supersedes the earlier AIMS-UI widget-sync failure. This does not certify newsletter signup: the earlier controlled recovery reported `already_processed`, but Jotform webhook registration subsequently returned HTTP/provider 401 on POST. The later green deployment skipped that conditional repair step. Neither result establishes mailbox receipt or confirmed active audience membership. See `COMMS_HUB_VERIFICATION_LEDGER_2026-10-08.md` for exact SHAs, run links, local checks and remaining acceptance criteria. Never trigger a newsletter campaign during this acceptance test.
