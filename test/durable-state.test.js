import test from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

function applyBaseEnv() {
  process.env.NODE_ENV = "production";
  process.env.LOG_LEVEL = "silent";
  process.env.R2_BUCKET_META_SYSTEM = "meta-system-bucket";
  process.env.R2_ENDPOINT = "https://example.invalid";
  process.env.R2_ACCESS_KEY_ID = "test-access";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
}

test.afterEach(() => {
  restoreEnv();
});

test("outreach resetProgress refuses local fallback in production when durable state is not configured", async () => {
  restoreEnv();
  process.env.NODE_ENV = "production";
  process.env.LOG_LEVEL = "silent";
  delete process.env.ALLOW_EPHEMERAL_STATE;
  delete process.env.R2_ENDPOINT;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET_META_SYSTEM;

  const mod = await import(`../services/outreach/services/batchService.js?case=${Date.now()}`);

  await assert.rejects(
    () => mod.resetProgress(0),
    /cannot fall back to local filesystem state in production/i
  );
});

test("outreach R2 progress loader propagates non-missing R2 failures", async () => {
  restoreEnv();
  applyBaseEnv();

  const r2Client = await import(`../services/shared/utils/r2-client.js?case=${Date.now()}`);
  r2Client.s3.send = async () => {
    const err = new Error("AccessDenied: signature mismatch");
    err.code = "AccessDenied";
    throw err;
  };

  const mod = await import(`../services/outreach/utils/r2ProgressStore.js?case=${Date.now()}`);

  await assert.rejects(
    () => mod.loadProgress(),
    /accessdenied|signature mismatch|bucket alias.*missing in env/i
  );
});

test("episode counter propagates non-missing R2 failures instead of resetting to 1", async () => {
  restoreEnv();
  applyBaseEnv();
  process.env.PODCAST_RSS_EP = "Yes";

  const r2Client = await import(`../services/shared/utils/r2-client.js?case=${Date.now()}`);
  r2Client.s3.send = async () => {
    const err = new Error("AccessDenied: forbidden");
    err.code = "AccessDenied";
    throw err;
  };

  const mod = await import(`../services/script/utils/episodeCounter.js?case=${Date.now()}`);

  await assert.rejects(
    () => mod.getNextEpisodeNumber(),
    /accessdenied|forbidden|bucket alias.*missing in env/i
  );
});
