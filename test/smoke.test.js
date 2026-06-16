import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.CORS_ORIGINS = "";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.ALLOW_EPHEMERAL_STATE = "true";

const { default: app } = await import("../server.js");
const jobStore = await import("../services/shared/utils/jobStore.js");

test("GET /health returns ok", async () => {
  const response = await request(app).get("/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.status, "ok");
});

test("GET /rss returns a structured service error instead of a 404 when RSS storage is unavailable", async () => {
  const response = await request(app).get("/rss");

  assert.equal(response.status, 500);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.route, "rss");
  assert.equal(response.body.message, "Failed to fetch RSS feed.");
  assert.equal("error" in response.body, false);
});

test("POST /rss returns a structured service error instead of a 404 when rewrite dependencies are unavailable", async () => {
  const response = await request(app).post("/rss").send({});

  assert.notEqual(response.status, 404);
  assert.equal(response.body.route, "rss");
});

test("GET /tts/status/:sessionId returns 404 for unknown job", async () => {
  const response = await request(app).get("/tts/status/TT-smoke-missing");
  assert.equal(response.status, 404);
  assert.equal(response.body.ok, false);
});

test("POST /outreach/keyword rejects invalid body", async () => {
  const response = await request(app)
    .post("/outreach/keyword")
    .send({ keyword: "" });

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
});

test("POST /blog/weekly/build rejects out-of-range days", async () => {
  const response = await request(app)
    .post("/blog/weekly/build")
    .send({ days: 99 });

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
});

test("POST /artwork/generate rejects invalid prompt payload", async () => {
  const response = await request(app)
    .post("/artwork/generate")
    .send({ prompt: "" });

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
});

test("malformed JSON returns 400 instead of 500", async () => {
  const response = await request(app)
    .post("/outreach/keyword")
    .set("content-type", "application/json")
    .send('{"keyword":');

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, "Invalid JSON body");
});

test("disallowed CORS origin returns 403", async () => {
  process.env.CORS_ORIGINS = "https://allowed.example";
  const { default: freshApp } = await import(`../server.js?cors=${Date.now()}`);
  const response = await request(freshApp)
    .get("/health")
    .set("Origin", "https://blocked.example");

  assert.equal(response.status, 403);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, "CORS origin not allowed");
});

test("POST /tts/orchestrate returns 202 when the same session is already running", async () => {
  const sessionId = `TT-tts-duplicate-${Date.now()}`;
  jobStore.startJob("tts", sessionId, { route: "test-preseed" });

  const response = await request(app)
    .post("/tts/orchestrate")
    .send({ sessionId });

  assert.equal(response.status, 202);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.duplicateJob, true);
  assert.equal(response.body.sessionId, sessionId);
});

test("POST /podcast/run returns 202 when the same session is already running", async () => {
  const sessionId = `TT-podcast-duplicate-${Date.now()}`;
  jobStore.startJob("podcast", sessionId, { route: "test-preseed" });

  const response = await request(app)
    .post("/podcast/run")
    .send({ sessionId });

  assert.equal(response.status, 202);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.duplicateJob, true);
  assert.equal(response.body.sessionId, sessionId);
});

test("POST /tts/orchestrate marks the job failed when orchestration returns ok=false", async () => {
  const sessionId = `TT-tts-fail-${Date.now()}`;
  const startResponse = await request(app)
    .post("/tts/orchestrate")
    .send({ sessionId });

  assert.equal(startResponse.status, 202);
  assert.equal(startResponse.body.ok, true);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const statusResponse = await request(app).get(`/tts/status/${encodeURIComponent(sessionId)}`);
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.body.ok, true);
  assert.equal(statusResponse.body.job.status, "failed");
});

test("job status responses do not expose stack traces", async () => {
  const sessionId = `TT-no-stack-${Date.now()}`;
  jobStore.failJob("tts", sessionId, new Error("kaboom"));

  const response = await request(app).get(`/tts/status/${encodeURIComponent(sessionId)}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.job.error.message, "kaboom");
  assert.equal("stack" in (response.body.job.error || {}), false);
});

test("POST /cloudflare/purge treats an empty webhook body as purge everything", async () => {
  process.env.CLOUDFLARE_PURGE_SHARED_SECRET = "test-secret";
  delete process.env.CF_purge;
  delete process.env.CF_zone;
  delete process.env.CLOUDFLARE_PURGE_API_TOKEN;
  delete process.env.CLOUDFLARE_ZONE_ID;

  const { default: freshApp } = await import(`../server.js?cf-empty=${Date.now()}`);
  const response = await request(freshApp)
    .post("/cloudflare/purge")
    .set("x-cloudflare-purge-secret", "test-secret")
    .send({});

  assert.equal(response.status, 500);
  assert.equal(response.body.ok, false);
  assert.match(response.body.error, /Missing zone id environment variable|Missing CF_zone|not configured/i);
});

test("POST /cloudflare/purge accepts unauthenticated webhook-style requests", async () => {
  process.env.CLOUDFLARE_PURGE_SHARED_SECRET = "test-secret";
  delete process.env.CF_purge;
  delete process.env.CF_zone;

  const { default: freshApp } = await import(`../server.js?cf-public=${Date.now()}`);
  const response = await request(freshApp)
    .post("/cloudflare/purge")
    .send({ purge_everything: true });

  assert.equal(response.status, 500);
  assert.equal(response.body.ok, false);
  assert.match(response.body.error, /Missing zone id environment variable|Missing CF_zone|not configured/i);
});

function clearDurableStateEnv() {
  delete process.env.R2_ENDPOINT;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET_META_SYSTEM;
  delete process.env.R2_META_SYSTEM_BUCKET;
  delete process.env.R2_BUCKET_METASYSTEM;
  delete process.env.R2_META_BUCKET;
  delete process.env.R2_BUCKET_META;
  delete process.env.REQUIRE_DURABLE_STATE;
}

function restoreTestEnv() {
  process.env.NODE_ENV = "test";
  process.env.STATE_BACKEND = "auto";
  process.env.ALLOW_EPHEMERAL_STATE = "true";
  delete process.env.REQUIRE_DURABLE_STATE;
}

test("production import falls back to local state when durable state is missing in auto mode", async () => {
  process.env.NODE_ENV = "production";
  process.env.STATE_BACKEND = "auto";
  process.env.ALLOW_EPHEMERAL_STATE = "false";
  clearDurableStateEnv();

  const mod = await import(`../services/shared/utils/stateFile.js?prod-auto-fallback=${Date.now()}`);
  assert.equal(typeof mod.readJsonState, "function");

  restoreTestEnv();
});

test("production import fails fast when durable state is explicitly required", async () => {
  process.env.NODE_ENV = "production";
  process.env.STATE_BACKEND = "r2";
  process.env.ALLOW_EPHEMERAL_STATE = "false";
  clearDurableStateEnv();

  await assert.rejects(
    () => import(`../services/shared/utils/stateFile.js?prod-r2-required=${Date.now()}`),
    /Production state backend is not durable|Configure R2 credentials/i
  );

  restoreTestEnv();
});


test("GET /livez and /readyz expose production health contracts", async () => {
  const live = await request(app).get("/livez");
  assert.equal(live.status, 200);
  assert.equal(live.body.status, "alive");
  assert.equal(live.headers["x-content-type-options"], "nosniff");

  const ready = await request(app).get("/readyz");
  assert.equal([200, 503].includes(ready.status), true);
  assert.equal(typeof ready.body.ready, "boolean");
  assert.equal(Array.isArray(ready.body.checks), true);
});
