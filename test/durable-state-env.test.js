import test from "node:test";
import assert from "node:assert/strict";

import {
  getDurableStateBucketName,
  getDurableStateBucketEnvName,
  getDurableStatePublicBaseUrl,
  hasDurableStateEnv,
} from "../services/shared/utils/durableStateEnv.js";

function buildEnv(overrides = {}) {
  return {
    R2_ENDPOINT: "https://r2.example.invalid",
    R2_ACCESS_KEY_ID: "access-key",
    R2_SECRET_ACCESS_KEY: "secret-key",
    ...overrides,
  };
}

test("durable state env accepts canonical metasystem bucket", () => {
  const env = buildEnv({ R2_BUCKET_META_SYSTEM: "metasystem" });

  assert.equal(hasDurableStateEnv(env), true);
  assert.equal(getDurableStateBucketName(env), "metasystem");
  assert.equal(getDurableStateBucketEnvName(env), "R2_BUCKET_META_SYSTEM");
});

test("durable state env accepts legacy R2_META_BUCKET without requiring env changes", () => {
  const env = buildEnv({
    R2_META_BUCKET: "legacy-meta-bucket",
    R2_PUBLIC_BASE_URL_META: "https://meta.example.invalid",
  });

  assert.equal(hasDurableStateEnv(env), true);
  assert.equal(getDurableStateBucketName(env), "legacy-meta-bucket");
  assert.equal(getDurableStateBucketEnvName(env), "R2_META_BUCKET");
  assert.equal(getDurableStatePublicBaseUrl(env), "https://meta.example.invalid");
});

test("r2-client metasystem alias resolves legacy R2_META_BUCKET", async () => {
  const originalEnv = { ...process.env };

  try {
    process.env.R2_ENDPOINT = "https://r2.example.invalid";
    process.env.R2_ACCESS_KEY_ID = "access-key";
    process.env.R2_SECRET_ACCESS_KEY = "secret-key";
    delete process.env.R2_BUCKET_META_SYSTEM;
    delete process.env.R2_PUBLIC_BASE_URL_META_SYSTEM;
    process.env.R2_META_BUCKET = "legacy-meta-bucket";
    process.env.R2_PUBLIC_BASE_URL_META = "https://meta.example.invalid";

    const mod = await import(`../services/shared/utils/r2-client.js?legacy-meta=${Date.now()}`);

    assert.equal(mod.R2_BUCKETS.metasystem, "legacy-meta-bucket");
    assert.equal(mod.R2_BUCKETS.metaSystem, "legacy-meta-bucket");
    assert.equal(mod.R2_PUBLIC_URLS.metasystem, null);
    assert.equal(mod.BUCKET_ENV_BY_ALIAS.metasystem, "R2_META_BUCKET");
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  }
});
