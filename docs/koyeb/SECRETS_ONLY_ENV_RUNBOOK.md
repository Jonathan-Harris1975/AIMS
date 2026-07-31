> **Document status:** Production reference
> **Last reviewed:** 16 June 2026
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Koyeb secrets-only environment runbook

Use this mode when Koyeb bulk environment editing is suspected of blocking builds or startup.

## What changed

AIMS now loads committed non-secret production defaults from:

```text
config/production.defaults.env
```

The loader gives priority to real environment variables first, then local `.env`, then committed defaults. This means Koyeb secrets still win, local development still works, and committed defaults only fill missing non-secret configuration.

## Koyeb setup

1. Remove the large bulk AIMS env paste from the Koyeb service.
2. Paste only the secret references from:

```text
koyeb-env/aims.secrets-only.txt
```

3. Keep `GOOGLE_PRIVATE_KEY` as an escaped one-line Koyeb secret value.
4. Do not paste `config/production.defaults.env` into Koyeb. It is part of the repo and loads at runtime.

## Why this is safer

Koyeb only has to manage credentials and tokens. Stable values such as model names, public URLs, bucket aliases, Blotato polling intervals, state backend mode, and RSS settings remain versioned with the repo.

## Validation commands

```bash
npm test
npm run build
npm run deploy:smoke
node scripts/koyebEnvDoctor.js koyeb-env/aims.secrets-only.txt
node scripts/koyebEnvDoctor.js config/production.defaults.env
```
