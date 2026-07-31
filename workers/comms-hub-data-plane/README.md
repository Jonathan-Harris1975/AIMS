# Comms Hub D1 data plane

This Cloudflare Worker is the runtime D1 bridge for Comms Hub social traffic. It binds the production D1 database directly and exposes:

- `POST /query` for one parameterised statement or a transactional batch of up to 100 parameterised statements;
- `GET /health`, which exposes no configuration or data.

The Worker accepts only `SELECT`, `INSERT`, `UPDATE` and `DELETE`. It rejects DDL, PRAGMA statements, SQL stacking, unauthenticated requests, bodies over 1 MB, oversized SQL and excessive parameters.

Comms Hub migrations do not use this endpoint. `npm run comms:migrate` deliberately uses Cloudflare's administrative D1 API so the runtime Worker can retain a narrower SQL contract.

## Deployment

1. Copy `wrangler.toml.example` to `wrangler.toml`.
2. Set the exact production D1 database ID.
3. Create a long random secret with `wrangler secret put COMMS_HUB_D1_PROXY_TOKEN`.
4. Deploy the Worker.
5. Set Koyeb `COMMS_HUB_D1_PROXY_URL=https://<worker-host>/query`.
6. Set Koyeb `COMMS_HUB_D1_PROXY_TOKEN` to the same secret.

Social channel families are deliberately not ready without this Worker. Jotform-only Phase 1 can continue to use Cloudflare's REST API when both social family switches are false.
