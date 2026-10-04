# CI automation ownership

Renovate alone chooses dependency versions, updates manifests/locks and opens dependency PRs. Dependabot configuration is passive: every version PR limit is zero. Disabling Dependabot security-update PRs is a separate live repository setting and must be verified independently.

Renovate never merges, enables native auto-merge or posts Mergify queue commands. Approved existing minor/patch/digest, security and lock-maintenance policies generate `dependency:auto-eligible`. Major/manual rules generate `dependency:manual`, which takes precedence. Trusted admission checks the exact Renovate identity, same repository, `renovate/` namespace, eligibility and exact-head required workflows before admission. Mergify alone merges admitted automation. PRs already armed for native auto-merge are withheld from Mergify admission.

The native ordinary branch lane excludes `renovate/`, `dependabot/`, `autonomy/`, `mergify/`, `automation/` and `codex/`. Codex changes use a dedicated branch and PR with all normal checks. This bootstrap PR has no self-merge authority. Kilo repairs established application behaviour through PRs and cannot change manifests, dependency locks or protected governance controls. autofix.ci remains mechanical only.

Production dependency rollback selects the exact failed merge SHA, merged Renovate PR and main base. It opens a recovery PR and grants no direct merge authority.

## Controls and timing

The existing security check name is retained. Trivy, Gitleaks, actionlint, Hadolint and zizmor run directly from pinned upstream tools with integrity verification. actionlint checks correctness; zizmor checks workflow security. Strict Renovate validation runs in the security workflow. Harden-Runner starts in audit mode on the security job. Scorecard is advisory and never changes dependency policy. Lychee remains N/A for AIMS.

Renovate discovery/lock maintenance runs Friday 18:00–20:00 Europe/London, before the Friday 20:00–22:30 CI slot. The existing launcher dispatches CI, CodeQL and Security as one CI phase. DAST remains Saturday 22:00–Sunday 00:00, Council Sunday 18:30–21:00. No DAST target or opt-in changed. Routine merging after final CI PASS must remain frozen until exact-SHA Council certification; the current estate does not yet have a demonstrated enforcement/receipt mechanism, so certification remains HOLD.

## Live verification still required

- Verify Dependabot security updates are disabled in repository settings and reconcile any unique security PR evidence before closing duplicates.
- Confirm the installed Mend Renovate, Mergify, Socket, autofix.ci and repair App scopes and identities.
- Confirm live dependency graph support before enabling Dependency Review.
- Resolve existing scanner findings without broad exceptions. The new zizmor gate deliberately reports existing findings.
- Observe a clean runner audit, real Renovate eligibility, manual hold, exact-head admission and Mergify merge through existing protections.
- Prove the CI-PASS-to-Council merge freeze and exact-SHA invalidation.
- Koyeb currently deploys from source. Actions builds ephemeral image tags and does not publish an addressable production image digest; do not manufacture attestation artefacts. Confirm provider OIDC support for the exact deployment flow before replacing credentials.

Existing open CI bootstrap PRs touch overlapping controllers. Their changes must be reconciled before merge so they cannot restore obsolete body-text admission or capture Codex branches.
