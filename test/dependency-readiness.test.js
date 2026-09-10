import test from "node:test";
import assert from "node:assert/strict";
import { clearDependencyProbeCache, probeDurableState, probeHeadroom, probeOpenRouter } from "../services/shared/readiness/dependencyProbes.js";

test("OpenRouter readiness performs a bounded authenticated reachability probe", async () => {
  clearDependencyProbeCache();
  let request = null;
  const result = await probeOpenRouter({
    env: { OPENROUTER_API_KEY: "test-key", OPENROUTER_API_BASE: "https://openrouter.example/v1", READINESS_PROBE_CACHE_MS: "1" },
    force: true,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(request.url, "https://openrouter.example/v1/models");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
});

test("R2 readiness marks configured-but-unreachable durable state as not ready", async () => {
  clearDependencyProbeCache();
  const result = await probeDurableState({
    env: {
      R2_ENDPOINT: "https://r2.example",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_META_SYSTEM: "meta",
      READINESS_PROBE_CACHE_MS: "1",
    },
    force: true,
    clientFactory: () => ({
      send: async () => { const error = new Error("forbidden"); error.$metadata = { httpStatusCode: 403 }; throw error; },
      destroy() {},
    }),
  });
  assert.equal(result.configured, true);
  assert.equal(result.ok, false);
  assert.equal(result.detail, "authentication");
});


test("Headroom readiness verifies the configured compression service and token", async () => {
  clearDependencyProbeCache();
  let request = null;
  const result = await probeHeadroom({
    env: {
      HEADROOM_ENABLED: "true",
      HEADROOM_BASE_URL: "http://headroom.internal:8787/v1/compress",
      HEADROOM_PROXY_TOKEN: "test-headroom-token",
      READINESS_PROBE_CACHE_MS: "1",
    },
    force: true,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200 };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.configured, true);
  assert.equal(request.url, "http://headroom.internal:8787/readyz");
  assert.equal(request.options.headers.authorization, "Bearer test-headroom-token");
  assert.equal(request.options.headers["x-headroom-proxy-token"], "test-headroom-token");
});

test("Headroom readiness is non-blocking when compression is deliberately disabled", async () => {
  clearDependencyProbeCache();
  const result = await probeHeadroom({ env: { HEADROOM_ENABLED: "false" }, force: true });
  assert.deepEqual(result, { ok: true, configured: false, detail: "disabled" });
});
