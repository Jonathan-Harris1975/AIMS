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

Social channel families are deliberately not ready without this Worker. Jotform-only Phase 1 can continue to use Cloudflare's REST API when both social family switches are false.
