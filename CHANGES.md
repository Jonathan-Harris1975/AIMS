# Koyeb environment build unblock patch

## Changed files

### Dockerfile
- Removed the optional BuildKit frontend directive so Koyeb's Docker builder does not need to fetch an external Dockerfile frontend before normal build output appears.
- Added bounded `timeout` wrappers around the network-heavy `apt-get` and `npm ci` build steps so remote builds fail loudly instead of remaining in a silent build state.

### package.json
- Added `env:audit` and `env:audit:file` scripts for Koyeb environment validation.

### scripts/koyebEnvAudit.js
- Added a dependency-free Koyeb bulk environment audit script.
- Fails on duplicate env keys, invalid env variable names, non-portable Koyeb secret reference names, and unresolved runtime placeholders.
- Redacts secret-like values from output.

### docs/koyeb/Koyeb_Environment_Fix.md
- Documents the confirmed environment issues found in the supplied workbook and the exact replacement values.

### koyeb-env/aims.bulk-env.cleaned.txt
- Cleaned AIMS bulk-edit environment file.
- Replaces `CF_purge={{ secret.CF-purge }}` with `CF_PURGE={{ secret.CF_PURGE }}`.
- Replaces `CF_zone={{ secret.CF_zone }}` with `CF_ZONE={{ secret.CF_ZONE }}`.
- Removes duplicate `AUDIT_ANALYSIS_MAX_WAIT_SECONDS`.
- Removes duplicated Blotato secret-reference account IDs and keeps the later literal account IDs to preserve current effective values.

### koyeb-env/rams.bulk-env.cleaned.txt
- Cleaned RAMS bulk-edit environment file.
- Trims the trailing space from `RMS_LIVE_WRITE_ENABLED=true`.

## Why this patch is safe

- No runtime route, request, response, R2 key, bucket, prompt, model, scheduling, or storage contract was changed.
- The Cloudflare purge code already supports the uppercase `CF_PURGE` and `CF_ZONE` aliases.
- The Blotato duplicate cleanup preserves the effective final values from the supplied list if interpreted in last-wins order.
- The new audit script is opt-in and does not run during application startup.

## Validation run

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --check scripts/koyebEnvAudit.js
node scripts/koyebEnvAudit.js /tmp/aims.original.env   # intentionally failed on the supplied workbook issues
node scripts/koyebEnvAudit.js koyeb-env/aims.bulk-env.cleaned.txt
node scripts/koyebEnvAudit.js koyeb-env/rams.bulk-env.cleaned.txt
npm run build
npm run deploy:smoke
npm test
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run build
npm run deploy:smoke
npm run env:audit:file -- koyeb-env/aims.bulk-env.cleaned.txt
npm run env:audit:file -- koyeb-env/rams.bulk-env.cleaned.txt
```
