# Comms Hub verification ledger — 8 October 2026

Checkpoint: scoped monitoring repair prepared; production acceptance remains **HOLD**.
Evidence collected on 8 October 2026; individual remote evidence timestamps below are UTC (Europe/London = UTC+1). This is not a claim that every production acceptance criterion has passed.

## Sources and prerequisite

All repositories are under https://github.com/Jonathan-Harris1975/ and were read from live `main`, with clean working trees at checkout. No AGENTS.md files were found in these checkouts. No open AIMS/AIMS-UI PRs were present at discovery. The isolated AIMS branch `codex/comms-worker-watch-failure-path-20261008` identifies this repair; check it and its PR before starting another implementation. No distributed programme lease was found or acquired.

| Repository | Inspected source SHA | Scope |
|---|---|---|
| AIMS | ed0e769b79105f1d94d223521b7d7867bf9000dc | Backend, existing verification tests, newsletter, watcher and deployment evidence |
| AIMS-UI | a966cb6db732daede959ca81adadf63f1fc33b44 | Client, gateway, console, metrics, tests and deployed integration |
| jonathan-harris-website | 6c58476aba290d410fd52cb4c0833e5709e399b3 | Newsletter page, embed and tests |
| HIVE | 7d6edd6967badf804ad2093f3c53a933c7165ab1 | Existing operations-event ingress only |
| HIVE-UI | c7e602b40370400c8f1750a044c513d398f09edf | Existing communications identity handoff only |

Current-source CI prerequisite passed for AIMS, AIMS-UI and website. Relevant evidence:

- AIMS CI: https://github.com/Jonathan-Harris1975/AIMS/actions/runs/37841241639
- AIMS deployed release/data-plane checks: https://github.com/Jonathan-Harris1975/AIMS/actions/runs/37841598786
- AIMS worker watch: https://github.com/Jonathan-Harris1975/AIMS/actions/runs/37841745838 — healthy, eleven expected worker identities, independent webhook configured. No incident occurred in this run; no notification delivery or stopped-worker latency is proved.
- AIMS-UI validation: https://github.com/Jonathan-Harris1975/AIMS-UI/actions/runs/37807574917
- AIMS-UI exact-release integration: https://github.com/Jonathan-Harris1975/AIMS-UI/actions/runs/37807871146 — passed; supersedes the old widget-sync failure in the earlier verification document.
- Website production readiness: https://github.com/Jonathan-Harris1975/jonathan-harris-website/actions/runs/37819189661
- Website deployed integration: https://github.com/Jonathan-Harris1975/jonathan-harris-website/actions/runs/37819775998

Those results apply to the listed source versions, not to this repair branch. The repair has not been merged or deployed. HIVE/HIVE-UI were inspected for narrow contracts, not certified as complete products.

## Priority ledger

| Priority | Status | Completed evidence | Remaining acceptance |
|---|---|---|---|
| P1 attachment lifecycle | BLOCKED_ENVIRONMENT | Existing authoritative inbound attachment/object join; stored reference plus clean scan/hash/scanner/time/promotion required; final unapproved draft dispatch rereads state. Local clean/quarantine/missing/read-error/concurrent-change/delayed-dispatch tests pass. | Real staged scan/promotion, dispatch and concurrent lifecycle validation across UI/backend; no external-send transaction guarantee is claimed. |
| P2 continuous watch | BLOCKED_ENVIRONMENT | Existing 7/37-minute schedule and healthy production check. Repaired skipped incident handling after runtime collection/setup failure and malformed response crashes; 11 local tests pass. | Merge/deploy repaired workflow after review; controlled stale worker/outage, scheduled detection, actual current handoff receipt, recovery and subsequent incident; measured latency. |
| P3 notification improvements | OUT_OF_SCOPE | Existing HIVE bearer-authenticated operations-event API and sender inspected only for compatibility. | No provider/channel/urgency changes. |
| P4 reply policy | BLOCKED_ENVIRONMENT | Existing repository verification records owner's retained 2–3 calendar-day policy on 3 October; no replacement policy invented. DST/weekend scheduler tests pass. | Production-equivalent controlled scheduler/E2E evidence under retained policy. |
| P5 observability | BLOCKED_ENVIRONMENT | Durable conversation outcomes and post-dispatch counting tested; AIMS-UI metrics schema/rendering/loading/error/stale-data tests pass. | Controlled real batch matched to runtime metrics and operator display. |
| P6 defaults | PASS | Existing aiEnabled fallback, explicit booleans and parser semantics pass local tests. UI sent provenance and person takeover tests pass; no new global autonomy toggle added. | Deployed effective configuration remains a separate overall release gate. |
| P7 newsletter | BLOCKED_ACCESS | Existing pending→confirmation→verified active architecture and local duplicate/concurrency/suppression/uncertain-send tests pass; website embed tests pass. | Jotform registration POST rejected with HTTP/provider 401; authorised provider/runtime correction and real controlled inbox/final-state verification required. |

Code completion: monitoring fix implemented and locally tested; **not a certification of all code paths**. E2E verification: partial existing deployed integration evidence, full autonomy/newsletter acceptance incomplete. Deployment verification: existing main versions have recorded passing checks; new repair is not deployed.

Comms Hub autonomy: **HOLD**. Newsletter sign-up: **HOLD**. Overall: **HOLD**. Do not label the programme implementation-complete while critical acceptance and the full production contract audit remain incomplete.

## Discovered cross-repository contract map

| Capability | AIMS-UI/public caller | AIMS authority and checks | Evidence/limit |
|---|---|---|---|
| Operator authentication | HIVE-UI communications handoff → AIMS-UI HttpOnly console session | Gateway signs actor/role/timestamp delegation; AIMS applies per-route RBAC | Gateway/delegation tests and recorded deployed integration; not a full permission-matrix live test |
| Inbox/review queue | GET `/console/api/ui/bootstrap`, `/queue` | GET `/comms-hub/ui/bootstrap`, `/queue`; ownerId mapped to owner, aiStatus filter | Existing backend queue test; bootstrap capped at 50; full backlog pagination acceptance remains open |
| Workspace/status/assignment | GET workspace; PATCH status/assignment | `/comms-hub/workspace/:id`, conversation mutation routes, optimistic version | Existing returned-version/conflict tests pass |
| Contacts/archives/search | Client contact/archives/search methods | Corresponding protected routes in `services/comms-hub/routes/index.js` | Source route/method inspection; no exhaustive live test claimed |
| Replies/approval/takeover | Console email/chat/social and approval controls | Scope-matched approval, send_reply/human_takeover permissions, current ownership and automation checks | Existing tests; no new customer messages sent |
| Attachments/quarantine | Binary attachment download; protected quarantine/replay | Attachment state, private object, scan/promotion and replay permissions | Local tests; deployed scan pipeline not exercised |
| Health/metrics | Console `/metrics`, channel/provider status | `/comms-hub/metrics` plus separate workerHealth; bounded autonomy/newsletter outcomes | UI correctly distinguishes sent, pending and confirmed; stale/error states tested |
| Worker watch | GitHub schedule → Koyeb runtime collector → Python watcher | `/comms-hub/workers/health`; expected inventory from production defaults | Fixed failure path; effective-runtime inventory comparison not fully established |
| Existing handoff | `scripts/ops_notify.py` | HIVE `/v1/ops/events`, bearer authentication, 202 receipt | Interface source inspected; healthy watch proves configuration presence, not delivery |
| Newsletter public signup | Website `/newsletter/` → Jotform `262733359026055` | `/comms-hub/intake/jotform` refetches authoritative provider submission/consent | Same form ID in embed/fallback; real hosted form settings remain unverified |
| Newsletter confirmation | Configured HTTPS origin `/newsletter/confirm/:token` | D1 subscriber/subscription/verification/suppression state | Token hashing/expiry, idempotence, suppression and uncertain SMTP tests; no live token accessed |

The map covers discovered affected paths and identifies remaining live audit work. It is not an assertion that every request/response, enum, pagination boundary or role has been exercised end to end.

## Newsletter failure evidence and exact next action

Run https://github.com/Jonathan-Harris1975/AIMS/actions/runs/37827815549 (source `96ab2cec8cbeac4f33d8d7985df2f69665f7358b`) recorded:

- 18:57:00 UTC: controlled recovery `ok:true,status:already_processed`.
- 18:57:04 UTC: `newsletter_webhook_provider_failed`, operation POST, HTTP 401, provider status 401.
- The later green current-main deployment skipped the conditional registration/recovery step. It does not resolve that failure.

No claim is made that `JOTFORM_API_KEY` is absent. Provider rejection is established; its exact cause (key permission/account/form access or provider policy) is not. Required capability: authorised Jotform form/webhook administration and runtime configuration inspection. Verify the effective `JOTFORM_API_KEY` can manage this form's webhook, preserve other hooks, and repeat supported registration only under authorisation to modify the provider resource. Do not print the key.

P7 sub-steps: (1) architecture source traced; (2) embed tested, hosted validation/UX pending; (3–4) local validation/consent/suppression tests pass; (5) SMTP and recovery unit/integration tests pass, real delivery pending; (6) token-state tests pass, actual confirmation pending; (7) local unsubscribe/suppression tests pass; (8) source configuration inspected, complete effective runtime audit pending; (9) bounded source metrics inspected; (10) existing automated suite passes; (11) real signup-to-active acceptance blocked.

Authoritative final audience requires active subscriber AND active `ai-edge` subscription AND `verified_at` AND no suppression. SMTP accepted, webhook replayed or `already_processed` alone is insufficient. Confirmation delivery is synchronous with a durable SMTP claim, not a separate confirmation queue. Ambiguous sends require reconciliation, never blind replay. No campaign, subscription, inbox action or production mutation was performed during this run.

Required remaining runtime evidence: effective Jotform origin/key scope, newsletter sender configuration (`ONECOM_NEWSLETTER_PASSWORD` presence/format without disclosure), trusted `COMMS_HUB_PUBLIC_BASE_URL`, D1 migration/resource state, controlled inbox receipt, final confirmed D1 state and duplicate/failure behaviour. These are access/environment gates, not invitations to bypass safeguards.

## Changed files and checks

Changed only in AIMS:

- `.github/workflows/comms-hub-worker-watch.yml`: incident handler runs after failed/skipped probe; bounded setup/probe durations.
- `scripts/comms_worker_watch.py`: failed probe classified; malformed nested schemas, timestamps, boolean numbers and duplicate identities fail closed.
- `scripts/test_comms_worker_watch.py`: failure-path, malformed-payload and workflow regression tests.
- `.github/workflows/ci.yml`: execute watcher tests in canonical CI.
- `docs/COMMS_HUB_AUTONOMY_NEWSLETTER_VERIFICATION.md`: align current watcher and acceptance evidence.
- This ledger.

Executed locally on Node v24.19.0 / npm 11.9.0; source pins Node 24.21.0 / npm 12.2.0 for AIMS, so local execution is supplementary to pinned CI:

| Command | Result |
|---|---|
| AIMS `npm ci --ignore-scripts --no-audit --no-fund` | exit 0; engine mismatch noted, dependencies installed |
| AIMS `npm run verify` | exit 0; lint/hygiene, 903 tests, build/import graph, environment reference passed |
| AIMS `python3 -B -m unittest discover -s scripts -p 'test_comms_worker_watch.py'` after repair | exit 0; 11 tests passed; injected failures reached mocked existing handoff and persisted incident state |
| AIMS `npm run lint` after repair | exit 0 |
| AIMS `git diff --check` | exit 0 |
| AIMS-UI `npm run validate` | exit 0; 73 tests, lint/check, secret/dependency checks, build/budget passed; existing JS warning band remains below hard limit |
| Website `node --test scripts/newsletter-embed.test.mjs` | exit 0; 2 tests passed |

No new merge, deployment or live failure injection was authorised by this prompt. Final review action: review the draft repair PR, obtain current-head CI, then authorise merge/deployment. Resume with this ledger, live SHAs and that PR; do not repeat completed source checks unless relevant inputs change. Then resolve Jotform administration access and run controlled staged acceptance.

## Deferred notification task

No notification redesign performed. Healthy watcher evidence shows the existing independent webhook configured but cannot prove receipt during an incident. Transport urgency/channel improvements remain out of scope; correct invocation during probe failure is P2 and is repaired here.
