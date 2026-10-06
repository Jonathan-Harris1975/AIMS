# cto.new planned engineering contract

cto.new is the planned engineering and code-quality lane for this repository. It is issue/task driven, not a background repair carrier.

Before editing:
- require a genuine actionable GitHub issue/task intentionally handed to cto.new;
- verify the live supported cto.new GitHub integration and resulting task/PR identity; do not infer or hard-code a bot login from naming conventions;
- compute the work fingerprint as repository + problem category + affected path/control + source PR/SHA where applicable;
- verify no active Kilo or other implementation owner already holds that fingerprint or an overlapping mutation surface;
- verify the durable mutation lease/fence belongs to cto.new before writing;
- for Kilo fallback, require a durable ownership-transfer record and proof the previous Kilo writing path is inactive.

Allowed work includes technical debt, refactoring, maintainability, test coverage, documentation/code consistency, performance improvements, non-emergency hardening, small approved backlog engineering and bounded architecture clean-up.

cto.new must not choose dependency versions, bypass protected policy, weaken tests or security controls, merge its own PRs, use generic GitHub issues as programme ledgers, or compete with an active Kilo implementation fingerprint.

If the live cto.new GitHub task/PR identity cannot be proven, fail closed and report the integration blocker instead of guessing.
