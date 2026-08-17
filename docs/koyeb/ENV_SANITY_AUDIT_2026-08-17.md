# Environment sanity audit — 2026-08-17

Scope: AIMS repository v2.13.6 compared with the supplied Koyeb production environment list.

## Findings fixed in v2.13.7

1. `deployment-check.js` still required `R2_PUBLIC_BASE_URL_AUDITS` even though the audits bucket has already been migrated to private authenticated R2. The duplicate `config/deployment-check.js` did not require it. The root deployment check is now aligned with the private-R2 design.
2. Newsletter operations are enabled in production (`AIMS_OPERATION_NEWSLETTER_ENABLED=true`) but the supplied Koyeb list did not include `BREVO_API_KEY`. The canonical Koyeb checklist now makes that requirement explicit.
3. Non-sensitive Comms Hub deployment values were unnecessarily held in Koyeb. `COMMS_HUB_AI_SEARCH_INSTANCES`, `COMMS_HUB_D1_PROXY_URL`, `COMMS_HUB_JOTFORM_SOURCE_TIMEZONE`, and `COMMS_HUB_PUBLIC_BASE_URL` now live in `config/production.defaults.env`; `R2_BUCKET_COMMS_HUB_PRIVATE` was already present there. `NEWSLETTER_AI_EDGE_FROM_EMAIL` also now defaults to `newsletter@jonathan-harris.online` in the repository.
4. The Koyeb env doctor rejected existing hyphenated secret names such as `CF-database-hive-API` and `admin-Jonathan-harris`. Its validator now accepts hyphens.
5. `WEB_API_KEY` is present in the supplied Koyeb list but has no runtime references in this AIMS repository. It is not included in the canonical checklist.
6. Root README and audit documentation contained stale public-audit and single-mailbox wording. These were aligned with the current private-audit and three-mailbox implementation.

## Koyeb additions / decisions

Required while newsletter operations remain enabled:

- `BREVO_API_KEY={{ secret.BREVO_API_KEY }}`

Recommended only if central operational alerts are intended:

- `OPS_ALERT_WEBHOOK_URL={{ secret.OPS_ALERT_WEBHOOK_URL }}`
- `OPS_ALERT_WEBHOOK_TOKEN={{ secret.OPS_ALERT_WEBHOOK_TOKEN }}`
- `QA_ALERT_WEBHOOK_URL={{ secret.QA_ALERT_WEBHOOK_URL }}` (optional high-severity QA delivery; treat the provider URL as sensitive)

Can be removed from the AIMS Koyeb service after confirming no external dependency:

- `WEB_API_KEY` (unused by AIMS runtime)

Do not add:

- `R2_PUBLIC_BASE_URL_AUDITS`; the audits bucket is private.

## Secret scan

No committed production credential literals, PEM private keys, AWS access keys, GitHub PATs, OpenRouter/OpenAI-style live keys, bearer tokens or credential-bearing URLs were found by the repository scan. Test fixtures contain obvious dummy credentials only.

## GitHub Actions secret references

The repository workflows reference these GitHub Actions secrets: `KOYEB_TOKEN`, `KOYEB_SERVICE`, `OPS_ALERT_WEBHOOK_URL`, `OPS_ALERT_WEBHOOK_TOKEN`, and `WEBSITE_REBUILD_HOOK`. The repository cannot prove whether those secret values exist in GitHub; that must be checked in GitHub repository settings.

## Runtime env-list drift

After adding the missing canonical/legacy security and credential names to the repository env templates, there are **no credential/security-like runtime env references missing from the repo env lists**. There remain 111 non-secret optional/tuning/platform variables that are only read when deliberately overriding an in-code default. They are listed in `RUNTIME_ENV_DEFAULT_ONLY_2026-08-17.txt` and should not be bulk-copied into Koyeb.

## Validation

- Supplied Koyeb bulk environment passes `scripts/koyebEnvDoctor.js`.
- Canonical `config/koyeb.production.env.example` passes the same validator.
- Effective Comms Hub readiness, using repository production defaults plus the supplied Koyeb values, reports no missing variables.
- Root deployment-required keys are all satisfied by repository defaults plus the supplied Koyeb values.
- `node --test test/koyeb-env-doctor.test.js`: 11/11 passed.
- `node scripts/buildCheck.js`: passed (396 source modules, 396 relative-import checks, 324 production dependency-graph modules).
- `npm run r2:policy:check`: passed (19 buckets classified; target-private public URLs blank/enforced).
- Static credential-literal scan found no committed production secret values.
- Full dependency-backed `npm test` was not run because the audit container did not have the repository dependencies installed; no full-suite claim is made.
