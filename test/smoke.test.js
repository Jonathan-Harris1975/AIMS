import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.CORS_ORIGINS = "";

const { default: app } = await import("../server.js");
const jobStore = await import("../services/shared/utils/jobStore.js");

test("GET /health returns ok", async () => {
  const response = await request(app).get("/health");
  assert.equal(response.status, 200);
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

  assert.equal(startResponse.status, 200);
  assert.equal(startResponse.body.ok, true);

  await new Promise((resolve) => setTimeout(resolve, 50));

  const statusResponse = await request(app).get(`/tts/status/${encodeURIComponent(sessionId)}`);
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.body.ok, true);
  assert.equal(statusResponse.body.job.status, "failed");
});
