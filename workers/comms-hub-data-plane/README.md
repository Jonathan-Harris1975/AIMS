# Comms Hub D1 data plane

This Cloudflare Worker is the runtime D1 bridge for Comms Hub social traffic. It binds the production D1 database directly and exposes:

- `POST /query` for one parameterised statement or a transactional batch of up to 100 parameterised statements;
- `GET /health`, which exposes no configuration or data.

The Worker accepts only `SELECT`, `INSERT`, `UPDATE` and `DELETE`. It rejects DDL, PRAGMA statements, SQL stacking, unauthenticated requests, bodies over 1 MB, oversized SQL and excessive parameters.

Comms Hub migrations do not use this endpoint. `npm run comms:migrate` deliberately uses Cloudflare's administrative D1 API so the runtime Worker can retain a narrower SQL contract.

## Deployment

1. Use the checked-in `wrangler.toml`; it is the canonical production Worker configuration. Do not create or commit a second `wrangler.toml` from a template.
2. Verify the production D1 database ID in `wrangler.toml` before deployment.
3. Pin Wrangler to `4.127.1` for local and CI deployments.
4. Create a long random secret with `npx --yes wrangler@4.127.1 secret put COMMS_HUB_D1_PROXY_TOKEN`.
5. Deploy with `npx --yes wrangler@4.127.1 deploy`.
6. Verify `GET /health` returns `{"ok":true,"service":"comms-hub-data-plane"}`.
7. Set Koyeb `COMMS_HUB_D1_PROXY_URL=https://<worker-host>/query`.
8. Set Koyeb `COMMS_HUB_D1_PROXY_TOKEN` to the same secret.

### Cloudflare Workers Builds configuration

The 3 October 2026 production build log passed `npm run build` but failed at the repository-root command `npx wrangler versions upload` with “Missing entry-point to Worker script or to assets directory”. The canonical configuration lives below the repository root. Keep the build root at the repository root when using `npm run build`, and set the upload command to:

```sh
npx --yes wrangler@4.127.1 versions upload --config workers/comms-hub-data-plane/wrangler.toml
```

Set the Workers Builds Node version to `24.21.0` and npm to `12.2.0`. The supplied log used Node `24.18.0`, which caused an engine warning; this warning was separate from the missing entry-point failure. Do not create a second root configuration or deploy the Express application as the Worker.

`versions upload` creates a version without promoting it to active production traffic. The existing Koyeb deployment watcher remains the production deployment path. Verify the upload result and the exact-SHA production watcher separately before calling the release ready. These dashboard settings have not been changed by this source repair.

References: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [Wrangler Worker commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/).

### Hardened Koyeb deployment

The production deployment watcher runs `node scripts/deployCommsHubDataPlaneWorker.js` inside the verified Koyeb deployment. The script uploads the self-contained ES module directly through Cloudflare's Workers API using the existing `D1_API_KEY` and `CLOUDFLARE_ACCOUNT_ID` / `CF_ACCOUNT_ID`. The token must have Workers Scripts Write permission, including access to Worker settings; a D1-only token is insufficient. Tokens remain inside Koyeb and are never printed or copied to GitHub.

The production image intentionally has no npm or npx. Do not restore these tools or install Wrangler inside the runtime. Wrangler remains pinned for local deployment and the CI dry run above.

`wrangler.toml` remains authoritative for the module, compatibility date, observability, preview URLs and D1 binding. The direct uploader supports this Worker's current scalar configuration only; duplicate keys, extra sections, unsupported settings or module imports stop deployment rather than silently omitting configuration. Extend and test the uploader before adding such features.

The uploader requires the existing `COMMS_HUB_D1_PROXY_TOKEN` secret binding before upload, retains all `secret_text` bindings, preserves the current workers.dev enabled state, applies the configured preview setting and verifies the resulting D1 binding, compatibility date, observability and required secret binding. It does not create, rotate or disclose secrets. Unexpected non-secret bindings stop deployment to prevent their removal. Bootstrap a new Worker and its secret through the manual Wrangler steps first.

Every Cloudflare request has a 60-second timeout and rejects redirects. Provider failures, malformed responses and failed verification exit non-zero without printing response bodies. Upload writes are not automatically retried: after an ambiguous timeout, inspect remote state before an explicit rerun. The watcher verifies public Worker health after upload and before issuing a deployment attestation. Health alone does not prove database-query readiness.

Run `node scripts/deployCommsHubDataPlaneWorker.js --check` to validate local configuration without credentials, network access or deployment. The Docker CI gate executes this inside the stripped production image. Run `node --test test/comms-hub-worker-deploy.test.js` for upload/preservation/failure regressions. Real deployment acceptance still requires a successful exact-SHA production watch and the downstream ecosystem smoke.

API contract: [Worker module upload](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/), [multipart metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/) and [Worker subdomain settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/).

Social channel families are deliberately not ready without this Worker. Jotform-only Phase 1 can continue to use Cloudflare's REST API when both social family switches are false.
