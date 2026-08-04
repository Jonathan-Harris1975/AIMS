# Comms Hub Phase 3 and Phase 4 Build Report

**Repository:** AIMS  
**Build date:** 4 August 2026  
**Delivery type:** additive live-repository patch with all new execution paths disabled by default

## Delivered requirements

| Requirement | Implementation |
|---|---|
| CH-013 / WF-004 | Persisted, resumable podcast contribution workflow with pre-check, assets, review, acceptance/rejection, episode link, backlink request, social offer and no guest-booking path |
| AI-001 | Strict-JSON intent classification with known-enum fallback |
| AI-002 | Reproducible factor-weighted priority score, queue routing and audited operator override |
| AI-004 | Dedicated AIMS model routes for triage, moderation, summary and each reply workflow |
| AI-005 | Cloudflare AI Search allow-list, evidence hashing and exact source-reference validation |
| AI-006 | Immutable scope-hashed approvals for risky drafts and moderation actions |
| AI-009 | Sentiment, abuse label, severity and risk classification |
| AI-010 | Platform capability matrix, approval gate, audit state and fail-closed quarantine |
| AI-011 | Persisted summaries, source message IDs, unresolved actions and source links |
| AI-012 | One idempotent follow-up for an unresolved open conversation |
| OB-002 | Persisted provider-health snapshots with healthy, degraded, rate-limited, unavailable and unknown states |
| OB-005 | Checksummed D1 SQL export, independent R2 archive copies, manifest/catalogue, isolated D1/R2 restore and count/checksum validation |

## Safety controls

- `COMMS_HUB_AI_ENABLED`, follow-up, provider-health and backup workers default to false.
- Human approval is forced on whenever Phase 3 AI is enabled, regardless of a false environment override.
- The follow-up worker cannot be enabled without Phase 3 AI, and automatic backups cannot be enabled without the backup service.
- Existing Phase 2 moderation does not acquire Phase 3 approval requirements while AI is disabled.
- Spam intent, workflow mismatch, missing evidence, elevated moderation risk and high priority all force review.
- AI transcript input is bounded to the newest 100 messages and 80,000 body characters.
- Approval scope binds the target type, target ID, action type and payload hash; a decision cannot be reused for a changed action.
- Unsupported moderation actions are quarantined before the provider client is resolved or called.
- Moderation audit terminal states cannot regress.
- D1 production IDs and live/backup/restore R2 bucket names must all be distinct.
- Backup object limits fail the run rather than silently truncating the archive.
- Restore validation reads the archived copies, not the live source objects.
- Restore validation refuses a target containing existing user tables before import begins.
- Manifest, D1 SQL and each archived R2 object are SHA-256 checked.
- Restored schemas and table record counts must match the backup manifest.
- R2 catalogue rows are marked verified only after archived bytes are copied to the restore bucket and re-read successfully.

## Database changes

Additive migrations:

- `0003_ai_workflows.sql`: AI runs/state/evidence, approvals, moderation audit, drafts, follow-ups, workflow runs/events and priority overrides.
- `0004_hardening.sql`: provider health, backup runs and archived-object catalogue.

Both migration manifests now require all four Comms Hub migrations. The complete migration chain was applied from an empty SQLite database during the targeted test run.

## Verification performed

- Phase 1 through Phase 4 targeted domain and hardening suite: **62 tests passed, 0 failed**.
- Covered fail-closed evidence handling, bounded long-thread input, immutable approvals, Phase 2 compatibility, priority overrides, workflow correction, podcast retries, invalid worker combinations, unsupported moderation quarantine, provider-state classification and deduplication, independent R2 archive/restore, non-empty restore-target refusal, manifest tampering, record-count mismatch, object-limit refusal and production-target refusal.
- JavaScript syntax checks, repository build check and `git diff --check` are part of the final packaging gate.

## Dependency-installation limitation in this sandbox

A clean `npm ci` could not complete because the configured package mirror returned HTTP 404 for the repository-locked `zod@3.25.76` package. The lockfile and dependency graph were deliberately left unchanged. The full dependency-driven repository test suite must therefore be rerun in the normal deployment environment where the locked package is available.

This is an environment limitation, not a licence to bypass the lockfile. Do not deploy after substituting a different package version.

## Deployment and canary sequence

1. Deploy the patch with every new Phase 3/4 switch false.
2. Install locked dependencies and run the full repository test/build chain.
3. Apply migrations 0003 and 0004 and confirm migration status.
4. Verify existing Jotform and Zernio smoke paths before enabling any new feature.
5. Configure only approved AI Search instances, then enable AI and test one low-risk draft, one approval-required draft and one unsupported moderation action.
6. Enable provider-health snapshots.
7. Configure distinct private backup and restore buckets plus a fresh, empty restore-only D1 database.
8. During a maintenance window, run one manual backup and validate its isolated restore.
9. Enable the follow-up worker after inspecting its first due item.
10. Enable automatic backups only after the manual recovery test succeeds.

Cloudflare documents that D1 exports and imports can block database requests. Keep them outside operational traffic until the maintenance window and rollback path have been exercised.

## Rollback

Disable, in this order:

1. `COMMS_HUB_BACKUP_AUTOMATIC_ENABLED`
2. `COMMS_HUB_FOLLOW_UP_WORKER_ENABLED`
3. `COMMS_HUB_PROVIDER_HEALTH_ENABLED`
4. `COMMS_HUB_AI_ENABLED`

Then redeploy the previous application revision. The new migrations are additive, so leave their tables in place during application rollback. Do not attempt an emergency destructive schema rollback.
