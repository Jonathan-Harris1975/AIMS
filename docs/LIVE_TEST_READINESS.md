# AIMS controlled live-test readiness ledger

Updated: 2026-10-10 UTC. This ledger distinguishes repository evidence from provider verification. **Status: CONDITIONAL / NOT YET APPROVED FOR LIVE TESTING.**

## Revision and completed changes

- Repository: `Jonathan-Harris1975/AIMS`; reviewed main SHA: `2d95d97c5143f718c731727858e163a3d01f6a8f`.
- PR #160 was merged as that SHA. It requires exact full-length Koyeb deployment SHA matching and rejects missing/unparseable timestamps when deployment freshness is required.
- Six focused regression tests were added in `scripts/test_watch_koyeb_exact_deployment.py`.
- PR head `8b09e7f47e4c8d68bd1a5e62f3e94548fbd5b432` had successful GitHub Actions workflows: AIMS CI, CodeQL, Security and repository quality, autofix.ci, Item 6 hardening, OpenSSF Scorecard advisory. These are **PR-head** results, not a substitute for post-merge deployment evidence.

## Required evidence before controlled live test

| Gate | Evidence required | Verified in this review |
| --- | --- | --- |
| Main-branch CI | Successful AIMS CI run for exact merged SHA, including Docker | No; PR-head CI passed only |
| Koyeb release | Successful `Koyeb production deployment watch` for exact SHA, with deployment attestation artifact and minimum-instance checks | Not established |
| Comms Hub data-plane | Successful worker deployment and `/health` response with expected service identity | Not established |
| Continuous worker monitoring | Successful `Comms Hub continuous worker watch` with sanitised health and incident-state evidence | Not established |
| Alert routing | Controlled synthetic alert received by authorised destination, with deduplication and no secrets exposed | Not established |
| Bounded autonomous repair | Non-production fault injection demonstrates bounded retries, escalation, idempotency, and human stop control | Not established |
| OIDC and GitHub App trust | Valid and invalid issuer/audience/signature/expiry tests, least-privilege token scope, rejection of untrusted workflow sources | Not established end to end |
| Eight-repository ecosystem | Exact-SHA evidence for AIMS, AIMS-UI, HIVE, HIVE-UI, IRS, MAST, RAMS and jonathan-harris-website; OIDC contract and dependency smoke checks | Not established |
| Operational rollback | Tested rollback to last known healthy deployment with measured recovery and preserved incident audit | Not established |
| PR reconciliation | No outstanding blocking PRs or approvals, branch protections satisfied | Must recheck at release time |

## Controlled live-test procedure (do not run destructively on production)

1. Record current `main` SHA and the last healthy deployment IDs; confirm secrets and provider variables exist without printing them.
2. Verify post-merge AIMS CI success on that SHA and download the corresponding Koyeb deployment attestation. Confirm exact SHA, service, run ID and timestamps.
3. Run read-only Koyeb and Worker health probes; retain timestamps and sanitised results.
4. Run a synthetic non-production alert and one bounded recovery scenario. Verify retries, deduplication, escalation, audit evidence and rollback; do not send real customer communications.
5. Verify all eight ecosystem OIDC/deployment contracts against immutable revisions.
6. Obtain explicit operational go/no-go approval. Abort on any unknown or failing gate, and roll back using the approved runbook.

## Evidence limitations

GitHub's commit-workflow query used in this review returns PR-triggered runs; an empty result for the merged SHA **does not** prove that post-merge runs did not occur. No provider credentials, deployment attestation, live health probe, or recovery simulation were available in this review. Do not describe the system as 100% ready until the gates above have evidence.
