import test from "node:test";
import assert from "node:assert/strict";
import { clearDependencyProbeCache, probeDurableState, probeOpenRouter } from "../services/shared/readiness/dependencyProbes.js";

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
