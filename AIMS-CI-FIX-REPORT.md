# AIMS CI Fix Report

## Root cause

The uploaded GitHub Actions run failed only at the production dependency audit.

The test and build stages completed successfully, and the Docker image also built successfully. The blocking command was:

```bash
npm audit --omit=dev --audit-level=critical
```

The lockfile contained one critical vulnerability chain through `fast-xml-parser`, plus high and moderate findings in several transitive packages.

## Changes

### Dependency security

- Updated the production dependency lockfile to patched releases.
- Updated `googleapis` from `^131.0.0` to `^173.0.0`.
- Removed the unused direct `xmlbuilder2` dependency.
- Updated AIMS from version `2.7.0` to `2.7.1`.
- Ensured every package tarball resolves through `registry.npmjs.org`.
- Eliminated all npm audit findings in the production dependency tree.

Notable resolved packages include:

- `axios` 1.18.0
- `fast-xml-parser` 5.9.0
- `@aws-sdk/client-s3` 3.1069.0
- `@aws-sdk/client-polly` 3.1069.0
- `express` 4.22.2
- `undici` 6.27.0
- `follow-redirects` 1.16.0
- `form-data` 4.0.6
- `qs` 6.15.2
- `path-to-regexp` 0.1.13

### GitHub Actions

- Updated `actions/checkout` from v4 to v6.
- Updated `actions/setup-node` from v4 to v6.
- Raised the production audit gate from `critical` to `high`.

## Verification

- Clean development install: passed.
- Complete AIMS test suite: 57 tests passed.
- Build check: passed.
- JavaScript syntax scan: passed.
- Production-only install: passed.
- Production dependency audit: 0 vulnerabilities.
- Google Sheets service import and no-op compatibility smoke test: passed.
- Internal package-registry references: none.

## Notes

The red `ERROR` entries printed during the test job are expected negative-path test logging. They did not represent test failures.

The uploaded Docker job passed before this patch. Docker was not available in the local patch environment, so the amended production dependency tree was verified using the same production-only npm installation and build commands used by the Dockerfile.

## Deployment

Replace the three corresponding files in the AIMS repository, commit them, and rerun GitHub Actions.
