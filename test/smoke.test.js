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

test("POST /cloudflare/purge rejects an empty body instead of defaulting to purge_everything", async () => {
  process.env.CLOUDFLARE_PURGE_SHARED_SECRET = "test-secret";
  const { default: freshApp } = await import(`../server.js?cf-empty=${Date.now()}`);
  const response = await request(freshApp)
    .post("/cloudflare/purge")
    .set("x-cloudflare-purge-secret", "test-secret")
    .send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  assert.match(response.body.error, /Provide exactly one purge mode/);
});

test("POST /cloudflare/purge requires the shared secret when configured", async () => {
  process.env.CLOUDFLARE_PURGE_SHARED_SECRET = "test-secret";
  const { default: freshApp } = await import(`../server.js?cf-auth=${Date.now()}`);
  const response = await request(freshApp)
    .post("/cloudflare/purge")
    .send({ purge_everything: true });

  assert.equal(response.status, 401);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, "Missing Cloudflare purge secret.");
});

test("production import fails fast when durable state is not configured and override is absent", async () => {
  process.env.NODE_ENV = "production";
  process.env.ALLOW_EPHEMERAL_STATE = "false";
  delete process.env.R2_ENDPOINT;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET_META_SYSTEM;

  await assert.rejects(
    () => import(`../services/shared/utils/stateFile.js?prod-guard=${Date.now()}`),
    /Production state backend is not durable|configured state directory resolves inside the container tmp filesystem/i
  );

  process.env.NODE_ENV = "test";
  process.env.ALLOW_EPHEMERAL_STATE = "true";
});
