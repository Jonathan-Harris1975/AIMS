# AIMS production operations

**Status:** Production-controlled  
**Last reviewed:** 16 June 2026

## Deployment

AIMS runs as a single Koyeb Web Service from the root Dockerfile. Use the configured production instance, keep `NODE_ENV=production`, and store all runtime credentials in Koyeb Secrets. The container starts through `dumb-init`, runs as the non-root `node` user and writes temporary local data only beneath `/app/local-data`.

## Probes

- Liveness: `GET /livez`
- Basic health: `GET /health`
- Readiness: `GET /readyz`
- Deeper operational status: `GET /ops/health` where the route is enabled and authenticated

A deployment is ready only when authentication, OpenRouter and durable-state configuration pass.

## Verification

Run `npm run verify`, the environment doctor and the Docker build before production. After deployment, probe health/readiness, inspect Koyeb logs for startup errors, and trigger one low-risk dry-run workflow before normal scheduling resumes.

## Recovery

For a failed release, restore the previous Koyeb deployment or revert the commit. Do not disable quarantine, authentication or durable-state gates merely to make a deployment green.
