# AIMS Koyeb build unblock and secrets-only env patch

## Confirmed defects fixed

- `test/koyeb-env-doctor.test.js` still expected the old truncated-env error wording, so `npm test` failed in the fresh uploaded repo before deployment sanity could pass.
- Koyeb was still being asked to carry a very large runtime env set. This patch adds a production-safe fallback model so Koyeb can carry only secrets while non-secret defaults live in the repo.

## Production-safe env change

- Added `config/loadEnv.js`.
- Added `config/production.defaults.env` with non-secret production defaults only.
- Added `koyeb-env/aims.secrets-only.txt` for Koyeb paste use.
- Replaced direct `dotenv/config` entrypoint imports with the repo loader.

Runtime precedence is:

1. Existing real environment variables, including Koyeb secrets.
2. Local `.env` for development or local deployment tests.
3. `config/production.defaults.env` for committed non-secret defaults.

## Safety notes

- Koyeb secret values still override committed defaults.
- Local `.env` still works.
- No public route paths, response JSON shapes, Blotato request shapes, R2 bucket names, or model routing contracts were changed.
- `OPENROUTER_BASE_URL` was deliberately left out of committed defaults to avoid overriding an explicitly supplied `OPENROUTER_API_BASE` alias in tests or custom deployments.

## Validation run

- `npm test`
- `npm run build`
- `npm run deploy:smoke`
- `env -i PATH=$PATH HOME=$HOME NODE_ENV=production ... npm run build`
- production-only `npm ci --omit=dev` followed by `npm run build`
- `node scripts/koyebEnvDoctor.js config/production.defaults.env`
- `node scripts/koyebEnvDoctor.js koyeb-env/aims.secrets-only.txt`
- `node --check` across all repository JavaScript files
