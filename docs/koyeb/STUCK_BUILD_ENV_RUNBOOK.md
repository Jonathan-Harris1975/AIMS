# Koyeb stuck in Building when env vars are added

## Diagnosis

The repository build path is healthy when the same env keys are provided as plain local values. If Koyeb builds without the env block but stalls when the full block is added, the blocker is almost certainly in Koyeb's environment-variable processing or a live Secret value, before application code runs.

Koyeb exposes configured environment variables during both build and runtime. A malformed bulk line, problematic interpolation reference, mixed-case Secret name, or raw multi-line Secret value can therefore affect deployment before the app starts.

## Confirmed env corrections in this patch

- `API_SECRET_PODCAST_INDEX` now references `{{ secret.API_SECRET_PODCAST_INDEX }}` instead of reusing the API key Secret.
- `Blotato_API_key` was replaced in the Koyeb paste file with the already-supported uppercase fallback `BLOTATO_API_KEY={{ secret.BLOTATO_API_KEY }}`.
- All Koyeb Secret references are normalised to `{{ secret.NAME }}`.
- A safe AIMS env block is supplied without `GOOGLE_PRIVATE_KEY` to isolate the one expected multi-line Secret.

## Files to use

### AIMS full canonical env

```text
koyeb-env/aims.bulk-env.canonical.txt
```

Use this after all referenced Secrets are confirmed to exist and `GOOGLE_PRIVATE_KEY` is stored as one line with escaped `\n` characters.

### AIMS safe unblock env

```text
koyeb-env/aims.bulk-env.safe-no-google-private-key.txt
```

Use this first if Koyeb still sticks in Building. It removes only `GOOGLE_PRIVATE_KEY`, leaving the rest of the service env intact. If this builds, recreate the `GOOGLE_PRIVATE_KEY` Secret as a one-line escaped value and then switch back to the full canonical file.

### RAMS canonical env

```text
koyeb-env/rams.bulk-env.canonical.txt
```

Use only for the RAMS service. Do not paste RAMS variables into the AIMS service.

## Required Secret names

For the AIMS service, ensure these Koyeb Secrets exist with these exact names:

```text
AIMS_API_KEY
API_APOLLO_KEY
API_HUNTER_KEY
API_KEY_PODCAST_INDEX
API_SECRET_PODCAST_INDEX
API_OPENPAGERANK_KEY
API_PROSPEO_KEY
API_SERP_KEY
API_URLSCAN_KEY
API_ZERO_KEY
AUDIT_CALLBACK_TOKEN
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
BLOTATO_API_KEY
CF_PURGE
CF_ZONE
GITHUB_TOKEN_WEBSITE_AUDITS
GOOGLE_PRIVATE_KEY
ONEUP_API_KEY
OPENROUTER_API_KEY
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
RAPIDAPI_KEY
RMS_API_KEY
WEB_API_KEY
```

## Private key rule

`GOOGLE_PRIVATE_KEY` should not be pasted into the Koyeb bulk env block as raw multi-line text. Store it as a Koyeb Secret, preferably as one line with escaped newlines:

```text
-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
```

The code already converts escaped `\n` back to real newlines at runtime.

## Validation commands

Run these locally before deployment:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run env:doctor:file -- koyeb-env/aims.bulk-env.canonical.txt
npm run env:doctor:file -- koyeb-env/aims.bulk-env.safe-no-google-private-key.txt
npm run env:doctor:file -- koyeb-env/rams.bulk-env.canonical.txt
npm run build
npm run deploy:smoke
npm test
```

## Deployment order

1. In Koyeb, delete the existing env block instead of layering the new block over it.
2. Remove old conflicting variables:
   - `CF_purge`
   - `CF_zone`
   - `Blotato_API_key`
3. Use Dockerfile builder with root `Dockerfile`.
4. Paste `koyeb-env/aims.bulk-env.safe-no-google-private-key.txt` first.
5. If it builds, recreate `GOOGLE_PRIVATE_KEY` as escaped `\n` text and deploy with `koyeb-env/aims.bulk-env.canonical.txt`.
6. If the safe file still sticks, one of the remaining live Secrets is malformed or not granted to the service. Recreate the Secrets listed above with exact uppercase names.

## Notes

Do not use the spreadsheet table sheets as the Koyeb paste source. Use the plain text files in `koyeb-env/` or the paste-only workbook sheets.
