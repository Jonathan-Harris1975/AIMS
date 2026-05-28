# Files safe for deletion

## Exact duplicate env handoff files

These are now exact duplicates of the primary env files and can be deleted once you are happy keeping only the primary canonical/safe files:

- `koyeb-env/repo_aims.bulk-env.canonical.txt`
- `koyeb-env/workbook_aims_canonical.env`
- `koyeb-env/repo_aims.bulk-env.safe-no-google-private-key.txt`
- `koyeb-env/workbook_aims_safe.env`

Keep instead:

- `koyeb-env/aims.bulk-env.canonical.txt`
- `koyeb-env/aims.bulk-env.safe-no-google-private-key.txt`

## Resolved/legacy cleanup files

These can be deleted after the corrected values have been copied into Koyeb and the service has been verified:

- `koyeb-env/aims.bulk-env.safe-no-google-private-key.txt.omitted-truncated-values.md`

These are already absent from the patched tree and can be deleted if still present locally:

- `koyeb-env/aims.bulk-env.canonical.txt.omitted-truncated-values.md`
- `koyeb-env/remove-legacy-conflicts.cli-env.txt`

## Old handoff reports

These are safe to delete only if you do not need the audit/deployment history:

- `NO_REPO_CODE_CHANGES.md`
- `KOYEB_DEPLOYMENT_FIX.md`
- `UPDATED_FILES_MANIFEST.txt`
- `REPORT.md`
