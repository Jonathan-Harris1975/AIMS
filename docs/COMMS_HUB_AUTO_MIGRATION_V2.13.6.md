# Comms Hub automatic schema recovery — AIMS v2.13.6

AIMS now automatically repairs Comms Hub schema drift during runtime startup.

When Comms Hub starts it first checks the migration ledger through the normal runtime D1 data plane. If one or more required migrations are missing and `COMMS_HUB_AUTO_MIGRATE_ON_START=true`, AIMS uses the existing administrative D1 credentials (`D1_UUID` and `D1_API_KEY`) to apply only the migrations declared in the Comms Hub migration manifest. It then verifies the schema again before starting Comms Hub workers.

The administrative migration path deliberately bypasses `COMMS_HUB_D1_PROXY_URL` because the runtime data-plane Worker does not allow DDL. The existing `npm run comms:migrate` and `npm run comms:migrate:status` commands use the same migration runner and remain available for explicit maintenance.

## Safety properties

- Automatic migration defaults to enabled and can be disabled with `COMMS_HUB_AUTO_MIGRATE_ON_START=false`.
- Applied migration checksums remain immutable. A checksum mismatch fails closed instead of rewriting production schema history.
- A lease-based D1 migration lock serialises concurrent AIMS instances and is renewed before each migration.
- Only versions listed in `services/comms-hub/migrations/manifest.js` are eligible for automatic application.
- Comms Hub workers do not start until the post-migration schema verification succeeds.
- If automatic migration cannot complete, runtime readiness remains false and logs use `comms_hub_auto_migration_failed` rather than pretending Comms Hub is healthy.

For the production drift seen on 2026-08-17, the first deployment of v2.13.6 will detect and apply the missing `0006_smart_response_forms`, `0007_business_hours_and_handoff`, and `0008_full_channel_activation` migrations automatically, then start Comms Hub normally.
