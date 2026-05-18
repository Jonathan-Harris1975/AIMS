import test from "node:test";
import assert from "node:assert/strict";
import { resolveCloudflarePurgeConfig } from "../services/cloudflare-purge/utils/purgeConfig.js";

test("Cloudflare purge config detects unresolved Koyeb token placeholder", () => {
  assert.throws(
    () => resolveCloudflarePurgeConfig({
      CF_zone: "zone-123",
      CF_purge: "{{ secret.CF-purge }}",
    }),
    /unresolved Koyeb secret placeholder/i
  );
});

test("Cloudflare purge config accepts preferred API token aliases", () => {
  const config = resolveCloudflarePurgeConfig({
    CLOUDFLARE_ZONE_ID: "zone-123",
    CLOUDFLARE_PURGE_API_TOKEN: "Bearer token-abc",
  });

  assert.equal(config.zoneId, "zone-123");
  assert.equal(config.zoneEnvKey, "CLOUDFLARE_ZONE_ID");
  assert.equal(config.token, "token-abc");
  assert.equal(config.tokenEnvKey, "CLOUDFLARE_PURGE_API_TOKEN");
  assert.equal(config.authMode, "api-token");
});

test("Cloudflare purge config still supports existing CF_purge and CF_zone env names", () => {
  const config = resolveCloudflarePurgeConfig({
    CF_zone: "zone-xyz",
    CF_purge: "token-xyz",
  });

  assert.equal(config.zoneId, "zone-xyz");
  assert.equal(config.zoneEnvKey, "CF_zone");
  assert.equal(config.token, "token-xyz");
  assert.equal(config.tokenEnvKey, "CF_purge");
});

test("Cloudflare purge config skips unresolved legacy env when a clean alias exists", () => {
  const config = resolveCloudflarePurgeConfig({
    CF_zone: "zone-123",
    CF_purge: "{{ secret.CF-purge }}",
    CLOUDFLARE_PURGE_API_TOKEN: "token-clean",
  });

  assert.equal(config.token, "token-clean");
  assert.equal(config.tokenEnvKey, "CLOUDFLARE_PURGE_API_TOKEN");
});
