import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.CORS_ORIGINS = "";

const { default: app } = await import("../server.js");

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


test("duplicate Hookdeck delivery is suppressed after successful acceptance", async () => {
  const eventId = `hookdeck-success-${Date.now()}`;

  const first = await request(app)
    .post("/outreach/batch/reset")
    .set("x-hookdeck-event-id", eventId)
    .send({ lastProcessedIndex: 1 });

  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);

  const second = await request(app)
    .post("/outreach/batch/reset")
    .set("x-hookdeck-event-id", eventId)
    .send({ lastProcessedIndex: 1 });

  assert.equal(second.status, 202);
  assert.equal(second.body.ok, true);
  assert.equal(second.body.duplicate, true);
});

test("invalid Hookdeck delivery is not permanently deduped", async () => {
  const eventId = `hookdeck-invalid-${Date.now()}`;

  const first = await request(app)
    .post("/outreach/keyword")
    .set("x-hookdeck-event-id", eventId)
    .send({ keyword: "" });

  assert.equal(first.status, 400);
  assert.equal(first.body.ok, false);

  const second = await request(app)
    .post("/outreach/keyword")
    .set("x-hookdeck-event-id", eventId)
    .send({ keyword: "" });

  assert.equal(second.status, 400);
  assert.equal(second.body.ok, false);
  assert.notEqual(second.body.duplicate, true);
});
