# CHANGES

## .github/workflows/ci.yml
- **Issue fixed:** The `Verify envBootstrap wrapper is not imported by app code` step used the pattern `\bENV\b`, which matched harmless comments and user-facing strings such as `ENV TUNABLES` and `Missing required ENV variables`.
- **Production impact:** Clean commits could fail CI even when `scripts/envBootstrap.js` was not imported by application code, blocking merges and deployments on a false positive.
- **Patch applied:** Narrowed the ripgrep pattern so it now detects explicit `scripts/envBootstrap.js` references and actual `ENV` import statements instead of any standalone `ENV` text.
- **Why this is safe:** This preserves the original guardrail objective without changing runtime code, request/response contracts, environment contracts, routes, or deployment behaviour.
