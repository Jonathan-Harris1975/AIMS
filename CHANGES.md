# Changes

## Dockerfile

- Isolated production dependency installation with `env -i` so Koyeb runtime env vars cannot affect Docker image construction.
- Added `npm run build` to the Docker image build, also under a minimal build-only environment.
- Preserved runtime command, health check, port, dependencies, and public contracts.

## nixpacks.toml

- Applied the same `env -i` isolation to the buildpack fallback install/build commands.
- Dockerfile remains the preferred builder; this only prevents the fallback path from inheriting runtime Blotato/R2/API env values.

## scripts/buildCheck.js

- Added a guard that fails the build if Dockerfile or Nixpacks build commands are no longer isolated from runtime env values.
- Kept the existing filesystem and lockfile checks.

## services/shared/utils/r2-client.js

- Added abort-backed R2 request timeouts using `R2_REQUEST_TIMEOUT_MS`, defaulting to 15000ms.
- Routed R2 get/put/list/delete calls through the timeout wrapper.
- This prevents remote state/R2 calls from hanging indefinitely during startup/background hydration.

## docs/koyeb/BUILD_STAGE_ENV_ISOLATION_FIX.md

- Added the deployment diagnosis, preserved runtime env contract, and validation commands.
