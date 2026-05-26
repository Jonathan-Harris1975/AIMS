# Koyeb deployment build fix

This patch hardens the AIMS deployment path for Koyeb after the previous `npm ci` blocker involving an internal OpenAI/caas registry URL.

## What changed

- `package-lock.json` is still clean: all tarball URLs resolve to `registry.npmjs.org`.
- `.npmrc`, `Dockerfile`, and `nixpacks.toml` now force the public npm registry and short, deterministic fetch retry settings.
- Production installs use `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`.
- `.dockerignore` no longer hides `Dockerfile*`, so Koyeb and other remote builders can always see the root Dockerfile.
- The Docker image now has a `/health` healthcheck using the Koyeb-provided `PORT` value.
- `npm run build` now performs a build-sanity check without requiring production secrets.
- `RSS_INIT_ON_BOOT` now defaults to `false` to stop deployment health being delayed by optional R2/RSS initialisation work.

## Koyeb settings to use

- Builder: Dockerfile
- Dockerfile path: `Dockerfile`
- Exposed port: `3000`
- Start command: leave blank, or use the image default `npm start`

## Useful validation commands

```bash
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm run build
npm run deploy:smoke
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

## CI durable-state guard fix

The latest CI failure was caused by the production durable-state guard behaving differently from the smoke-test contract:

- `STATE_BACKEND=auto` must let the web service boot when R2 state is missing, while logging a clear local-state warning.
- `STATE_BACKEND=r2` or `REQUIRE_DURABLE_STATE=true` must fail fast when durable R2 state is missing.
- `scripts/startupCheck.js` now follows the same rule, so a post-start check no longer marks a healthy Koyeb deployment as failed simply because `auto` mode is temporarily using local state.

Recommended stabilisation env:

```text
STATE_BACKEND=auto
RSS_INIT_ON_BOOT=false
```

Only enable strict durable state once the R2 variables are confirmed in Koyeb:

```text
STATE_BACKEND=r2
# or
REQUIRE_DURABLE_STATE=true
```

