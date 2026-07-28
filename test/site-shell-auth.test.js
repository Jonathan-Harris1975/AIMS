import test from "node:test";
import assert from "node:assert/strict";
import { getSiteShellSyncAuthStrategy, isSiteShellSyncPath } from "../services/shared/middleware/suiteAuth.js";

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return fn(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function requestWithHeader(name, value) {
  return {
    method: "POST",
    originalUrl: "/cloudflare/site-shell/sync",
    headers: { [name.toLowerCase()]: value },
    get: (requested) => requested.toLowerCase() === name.toLowerCase() ? value : "",
  };
}

test("site-shell sync path is POST-only", () => {
  assert.equal(isSiteShellSyncPath({ method: "POST", originalUrl: "/cloudflare/site-shell/sync" }), true);
  assert.equal(isSiteShellSyncPath({ method: "GET", originalUrl: "/cloudflare/site-shell/sync" }), false);
});

test("site-shell sync accepts its dedicated deployment secret", () => withEnv({
  NODE_ENV: "production",
  AIMS_API_KEY: "aims-key",
  SITE_SHELL_SYNC_SHARED_SECRET: "sync-secret",
  CLOUDFLARE_PURGE_SHARED_SECRET: "purge-secret",
  CLOUDFLARE_PURGE_ALLOW_PUBLIC: "true",
}, () => {
  assert.equal(
    getSiteShellSyncAuthStrategy(requestWithHeader("x-cloudflare-purge-secret", "sync-secret")),
    "site-shell-sync-secret",
  );
  assert.equal(
    getSiteShellSyncAuthStrategy(requestWithHeader("x-cloudflare-purge-secret", "purge-secret")),
    null,
  );
  assert.equal(getSiteShellSyncAuthStrategy({ method: "POST", originalUrl: "/cloudflare/site-shell/sync", headers: {}, get: () => "" }), null);
}));

test("site-shell sync falls back to the purge secret when no dedicated secret is configured", () => withEnv({
  NODE_ENV: "production",
  AIMS_API_KEY: "aims-key",
  SITE_SHELL_SYNC_SHARED_SECRET: undefined,
  CLOUDFLARE_PURGE_SHARED_SECRET: "purge-secret",
}, () => {
  assert.equal(
    getSiteShellSyncAuthStrategy(requestWithHeader("x-cloudflare-purge-secret", "purge-secret")),
    "site-shell-sync-secret",
  );
}));
